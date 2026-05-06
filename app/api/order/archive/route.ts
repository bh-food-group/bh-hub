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

    // When archiving real Shopify orders, remove only the relevant line items (qty → 0)
    // rather than all items — a Shopify order may be split across multiple POs.
    if (archive && shopifyOrderIds?.length && isShopifyAdminEnvConfigured()) {
      // Scope to line items linked to the specific POs being archived, or any PO-linked
      // items when archiving Shopify orders directly (no purchaseOrderIds given).
      const lineItemFilter = purchaseOrderIds?.length
        ? { purchaseOrderLineItems: { some: { purchaseOrderId: { in: purchaseOrderIds } } } }
        : { purchaseOrderLineItems: { some: {} } };

      const rows = await prisma.shopifyOrder.findMany({
        where: { id: { in: shopifyOrderIds }, isReplacementOrder: { not: true } },
        select: {
          shopifyGid: true,
          lineItems: { where: lineItemFilter, select: { shopifyGid: true } },
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
