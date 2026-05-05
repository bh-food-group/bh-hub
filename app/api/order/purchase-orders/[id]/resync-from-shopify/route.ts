import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { parseBody, purchaseOrderResyncFromShopifyBodySchema } from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import { resyncPurchaseOrderLineItemsFromShopify } from '@/lib/order/resync-po-from-shopify';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id: purchaseOrderId } = await context.params;
    const parsed = await parseBody(request, purchaseOrderResyncFromShopifyBodySchema);
    if ('error' in parsed) return parsed.error;
    const { data } = parsed;

    await resyncPurchaseOrderLineItemsFromShopify({
      purchaseOrderId,
      appendFromShopifyOrderId: data.appendFromShopifyOrderLocalId ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(
      err,
      'POST /api/order/purchase-orders/[id]/resync-from-shopify',
    );
  }
}
