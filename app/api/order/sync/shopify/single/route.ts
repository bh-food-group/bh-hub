/**
 * POST /api/order/sync/shopify/single
 * Body: { orderName: string }  — e.g. "1234" or "#1234"
 *
 * Fetches the matching Shopify order by name and upserts it locally.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { getShopifyAdminEnv, isShopifyAdminEnvConfigured } from '@/lib/shopify/env';
import { fetchShopifyOrdersPageFromEnv } from '@/lib/shopify/fetchOrders';
import { syncOneOrder } from '@/lib/shopify/sync/upsert-order';
import { createShopifyAdminGraphqlClient } from '@/lib/shopify/createFulfillment';

export async function POST(request: NextRequest) {
  const gate = await requireOrderManager();
  if (!gate.ok) return gate.response;

  if (!isShopifyAdminEnvConfigured()) {
    return NextResponse.json({ error: 'Shopify credentials not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const rawName = typeof body?.orderName === 'string' ? body.orderName.trim() : '';
  if (!rawName) {
    return NextResponse.json({ error: 'orderName is required' }, { status: 400 });
  }

  // Strip leading # and whitespace so both "1234" and "#1234" work
  const orderNumber = rawName.replace(/^#/, '').trim();
  if (!orderNumber) {
    return NextResponse.json({ error: 'Invalid order name' }, { status: 400 });
  }

  try {
    const data = await fetchShopifyOrdersPageFromEnv({
      first: 1,
      query: `name:${orderNumber}`,
    });

    const edges = data.orders.edges;
    if (edges.length === 0) {
      return NextResponse.json(
        { error: `Order #${orderNumber} not found in Shopify` },
        { status: 404 },
      );
    }

    const order = edges[0].node;
    const shopifyAdminClient = createShopifyAdminGraphqlClient(getShopifyAdminEnv());
    await syncOneOrder(order, shopifyAdminClient);

    return NextResponse.json({ ok: true, orderName: order.name });
  } catch (err) {
    console.error('[sync/shopify/single] Error:', err);
    return NextResponse.json(
      { error: 'Sync failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
