import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { parseBody, shopifyOrderApplyEditBodySchema } from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import { resyncPurchaseOrderLineItemsFromShopify } from '@/lib/order/resync-po-from-shopify';
import { isHubOnlyShopifyOrderGid } from '@/lib/order/hub-only-shopify-order';
import { fetchShopifyOrderNodeByGid } from '@/lib/shopify/fetchOrders';
import { getShopifyAdminEnv } from '@/lib/shopify/env';
import {
  applyOrderEditAndCommit,
  applyVariantCatalogPriceUpdates,
  type OrderEditOperation,
} from '@/lib/shopify/orderEdit';
import { syncOneOrder } from '@/lib/shopify/sync/upsert-order';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id: localOrderId } = await context.params;
    const parsed = await parseBody(request, shopifyOrderApplyEditBodySchema);
    if ('error' in parsed) return parsed.error;
    const { data } = parsed;

    const hasShopifyOps = data.operations.length > 0;
    const hasCostPatches = (data.costPatches?.length ?? 0) > 0;

    if (!hasShopifyOps && !hasCostPatches) {
      return NextResponse.json({ error: 'No operations provided' }, { status: 400 });
    }

    const order = await prisma.shopifyOrder.findUnique({
      where: { id: localOrderId },
      select: { id: true, shopifyGid: true },
    });
    if (!order) {
      return NextResponse.json({ error: 'Shopify order not found' }, { status: 404 });
    }

    if (hasShopifyOps && isHubOnlyShopifyOrderGid(order.shopifyGid)) {
      return NextResponse.json(
        {
          error:
            'This order exists only in the hub (no Shopify sale) and cannot be edited via Shopify.',
        },
        { status: 400 },
      );
    }

    const creds = getShopifyAdminEnv();

    if (hasShopifyOps) {
      await applyOrderEditAndCommit(
        creds,
        order.shopifyGid,
        data.operations as OrderEditOperation[],
        { notifyCustomer: false },
      );

      const variantCatalogUpdates = data.variantCatalogUpdates;
      const hasVariantUpdates = Boolean(variantCatalogUpdates?.length);
      const syncOutcome = (async (): Promise<boolean> => {
        const node = await fetchShopifyOrderNodeByGid(creds, order.shopifyGid, {
          lineItems: 'sync',
        });
        if (!node) return false;
        // syncOneOrder resolves each line item's FulfillmentOrder location
        // internally, so edited/added items keep their vendor+location supplier
        // mapping instead of falling into "Unassigned".
        await syncOneOrder(node);
        return true;
      })();

      const [, ok] = await Promise.all([
        hasVariantUpdates && variantCatalogUpdates
          ? applyVariantCatalogPriceUpdates(creds, variantCatalogUpdates)
          : Promise.resolve(),
        syncOutcome,
      ]);

      if (!ok) {
        return NextResponse.json(
          { error: 'Could not reload order from Shopify after edit.' },
          { status: 502 },
        );
      }
    }

    // Apply hub-DB-only cost patches (after sync so newly-added custom items exist in DB)
    if (hasCostPatches) {
      await Promise.all(
        (data.costPatches ?? []).map((patch) => {
          if (patch.shopifyLineItemGid) {
            return prisma.shopifyOrderLineItem.updateMany({
              where: { shopifyGid: patch.shopifyLineItemGid },
              data: { unitCost: patch.unitCost },
            });
          }
          if (patch.title) {
            return prisma.shopifyOrderLineItem.updateMany({
              where: { orderId: order.id, title: patch.title, variantGid: null },
              data: { unitCost: patch.unitCost },
            });
          }
          return null;
        }),
      );
    }

    // Stamp vendor on newly-added custom items so they're grouped under the right supplier in inbox.
    const addedCustomTitles = hasShopifyOps
      ? data.operations
          .filter((op) => op.type === 'addCustomItem')
          .map((op) => (op as { title: string }).title)
      : [];
    if (addedCustomTitles.length > 0 && data.purchaseOrderId) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: data.purchaseOrderId },
        select: { supplier: { select: { shopifyVendorName: true } } },
      });
      const vendorName = po?.supplier?.shopifyVendorName ?? null;
      if (vendorName) {
        await Promise.all(
          addedCustomTitles.map((title) =>
            prisma.shopifyOrderLineItem.updateMany({
              where: { orderId: order.id, title, variantGid: null, vendor: null },
              data: { vendor: vendorName },
            }),
          ),
        );
      }
    }

    if (hasShopifyOps && data.purchaseOrderId && !data.deferPurchaseOrderResync) {
      await resyncPurchaseOrderLineItemsFromShopify({
        purchaseOrderId: data.purchaseOrderId,
        appendFromShopifyOrderId: data.appendLinesFromShopifyOrderLocalId ?? null,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'POST /api/shopify/orders/[id]/apply-edit');
  }
}
