import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';
import { applyOrderEditAndCommitFromEnv } from '@/lib/shopify/orderEdit';
import { isShopifyAdminEnvConfigured } from '@/lib/shopify/env';

export async function POST(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const body = await request.json();
    const { purchaseOrderIds, shopifyOrderIds, archive } = body as {
      purchaseOrderIds?: string[];
      shopifyOrderIds?: string[];
      archive: boolean;
    };

    if (!purchaseOrderIds?.length && !shopifyOrderIds?.length) {
      return NextResponse.json(
        { error: 'At least one of purchaseOrderIds or shopifyOrderIds required' },
        { status: 400 },
      );
    }

    const now = new Date();

    // When archiving real Shopify orders, remove their line items on Shopify (qty → 0)
    // rather than cancelling the whole order — the order is often split across POs.
    if (archive && shopifyOrderIds?.length && isShopifyAdminEnvConfigured()) {
      const rows = await prisma.shopifyOrder.findMany({
        where: { id: { in: shopifyOrderIds }, isCustomOrder: { not: true } },
        select: {
          shopifyGid: true,
          lineItems: { select: { shopifyGid: true } },
        },
      });

      const results = await Promise.allSettled(
        rows
          .filter((r) => r.shopifyGid?.startsWith('gid://shopify/Order/'))
          .map((r) => {
            const ops = r.lineItems
              .filter((li) => li.shopifyGid?.startsWith('gid://shopify/LineItem/'))
              .map((li) => ({
                type: 'setQuantity' as const,
                shopifyLineItemGid: li.shopifyGid!,
                quantity: 0,
                restock: false,
              }));
            if (ops.length === 0) return Promise.resolve();
            return applyOrderEditAndCommitFromEnv(r.shopifyGid!, ops);
          }),
      );
      for (const r of results) {
        if (r.status === 'rejected') {
          console.error('[archive] Shopify line item removal failed:', r.reason);
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      if (purchaseOrderIds?.length) {
        await tx.purchaseOrder.updateMany({
          where: { id: { in: purchaseOrderIds } },
          data: { archivedAt: archive ? now : null },
        });
      }
      if (shopifyOrderIds?.length) {
        await tx.shopifyOrder.updateMany({
          where: { id: { in: shopifyOrderIds } },
          data: { archivedAt: archive ? now : null },
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'POST /api/order/archive error:');
  }
}
