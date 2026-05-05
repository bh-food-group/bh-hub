import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';
import { cancelShopifyOrderFromEnv } from '@/lib/shopify/orderEdit';
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

    // Cancel real Shopify orders when archiving (best-effort; DB archive still proceeds).
    if (archive && shopifyOrderIds?.length && isShopifyAdminEnvConfigured()) {
      const rows = await prisma.shopifyOrder.findMany({
        where: { id: { in: shopifyOrderIds }, isCustomOrder: { not: true } },
        select: { shopifyGid: true },
      });
      const gids = rows
        .map((r) => r.shopifyGid)
        .filter((g): g is string => Boolean(g) && g.startsWith('gid://shopify/Order/'));

      if (gids.length > 0) {
        const results = await Promise.allSettled(gids.map((gid) => cancelShopifyOrderFromEnv(gid)));
        for (const r of results) {
          if (r.status === 'rejected') {
            console.error('[archive] Shopify order cancel failed:', r.reason);
          }
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
