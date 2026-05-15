/**
 * POST /api/webhooks/shopify — Shopify webhook receiver.
 *
 * Handles topics: orders/create, orders/updated, fulfillments/create, fulfillments/update.
 * Verifies HMAC-SHA256 signature using SHOPIFY_WEBHOOK_SECRET.
 *
 * The webhook payload uses Shopify's REST representation. We convert the
 * relevant fields into our ShopifyOrderNode shape and delegate to the shared
 * upsert-order utility.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/core/prisma';
import { recomputePurchaseOrderStatusesForShopifyOrderId } from '@/lib/order/purchase-order-status';
import { syncOneOrder } from '@/lib/shopify/sync/upsert-order';
import { effectiveRestOrderLineItemQuantity } from '@/lib/shopify/line-item-effective-quantity';
import type { ShopifyOrderNode } from '@/types/shopify';
import { createShopifyAdminGraphqlClient } from '@/lib/shopify/createFulfillment';
import { getShopifyAdminEnv, isShopifyAdminEnvConfigured } from '@/lib/shopify/env';

function verifyHmac(body: string, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error('[webhook/shopify] SHOPIFY_WEBHOOK_SECRET not configured');
    return false;
  }
  if (!hmacHeader) return false;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');
  const a = Buffer.from(computed);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Convert Shopify REST webhook order payload to our GraphQL-shaped
 * ShopifyOrderNode. The webhook sends REST-format JSON, so field names differ.
 */
function restOrderToNode(o: any): ShopifyOrderNode {
  const adminGid = (id: number | string) => `gid://shopify/Order/${id}`;
  const customerGid = (id: number | string) =>
    `gid://shopify/Customer/${id}`;
  const lineItemGid = (id: number | string) =>
    `gid://shopify/LineItem/${id}`;

  return {
    id: typeof o.admin_graphql_api_id === 'string' ? o.admin_graphql_api_id : adminGid(o.id),
    name: o.name ?? null,
    email: o.email ?? null,
    note: typeof o.note === 'string' ? (o.note.trim() || null) : null,
    customer: o.customer
      ? {
          id: o.customer.admin_graphql_api_id ?? customerGid(o.customer.id),
          displayName:
            [o.customer.first_name, o.customer.last_name]
              .filter(Boolean)
              .join(' ') || o.customer.email || null,
          firstName: o.customer.first_name ?? null,
          lastName: o.customer.last_name ?? null,
          email: o.customer.email ?? null,
          phone: o.customer.phone ?? null,
          defaultAddress: o.customer.default_address
            ? {
                address1: o.customer.default_address.address1 ?? null,
                address2: o.customer.default_address.address2 ?? null,
                city: o.customer.default_address.city ?? null,
                province: o.customer.default_address.province ?? null,
                provinceCode: o.customer.default_address.province_code ?? null,
                country: o.customer.default_address.country ?? null,
                zip: o.customer.default_address.zip ?? null,
                company: o.customer.default_address.company ?? null,
                name: o.customer.default_address.name ?? null,
                phone: o.customer.default_address.phone ?? null,
              }
            : null,
        }
      : null,
    processedAt: o.processed_at ?? null,
    createdAt: o.created_at,
    displayFinancialStatus: o.financial_status
      ? String(o.financial_status).toUpperCase()
      : null,
    displayFulfillmentStatus: o.fulfillment_status
      ? String(o.fulfillment_status).toUpperCase()
      : 'UNFULFILLED',
    currencyCode: o.currency ?? 'CAD',
    totalPriceSet: {
      shopMoney: {
        amount: o.total_price ?? '0',
        currencyCode: o.currency ?? 'CAD',
      },
    },
    billingAddress: o.billing_address
      ? {
          address1: o.billing_address.address1 ?? null,
          address2: o.billing_address.address2 ?? null,
          city: o.billing_address.city ?? null,
          province: o.billing_address.province ?? null,
          provinceCode: o.billing_address.province_code ?? null,
          country: o.billing_address.country ?? null,
          zip: o.billing_address.zip ?? null,
          company: o.billing_address.company ?? null,
          name: o.billing_address.name ?? null,
          phone: o.billing_address.phone ?? null,
        }
      : null,
    shippingAddress: o.shipping_address
      ? {
          address1: o.shipping_address.address1 ?? null,
          address2: o.shipping_address.address2 ?? null,
          city: o.shipping_address.city ?? null,
          province: o.shipping_address.province ?? null,
          provinceCode: o.shipping_address.province_code ?? null,
          country: o.shipping_address.country ?? null,
          zip: o.shipping_address.zip ?? null,
          company: o.shipping_address.company ?? null,
          name: o.shipping_address.name ?? null,
          phone: o.shipping_address.phone ?? null,
        }
      : null,
    lineItems: {
      edges: (o.line_items ?? []).map((li: any) => {
        const effQty = effectiveRestOrderLineItemQuantity(li);
        return {
          node: {
            id: li.admin_graphql_api_id ?? lineItemGid(li.id),
            title: li.title ?? '',
            quantity: effQty,
            sku: li.sku ?? null,
            vendor: li.vendor ?? null,
            discountedUnitPriceSet:
              li.price != null && li.price !== ''
                ? {
                    shopMoney: {
                      amount: String(li.price),
                      currencyCode: o.currency ?? 'CAD',
                    },
                  }
                : null,
            variant: li.variant_id
              ? {
                  id: `gid://shopify/ProductVariant/${li.variant_id}`,
                  title: li.variant_title ?? null,
                  sku: li.sku ?? null,
                  product:
                    li.product_id != null
                      ? { id: `gid://shopify/Product/${li.product_id}` }
                      : null,
                  inventoryItem: null,
                }
              : null,
          },
        };
      }),
    },
  } as ShopifyOrderNode;
}

/**
 * Sync a Shopify customer from a REST webhook payload into local DB.
 * Updates displayName, email, phone, company, and default address.
 */
async function syncCustomerFromWebhook(c: any) {
  const shopifyGid = c.admin_graphql_api_id ?? `gid://shopify/Customer/${c.id}`;

  const displayName =
    [c.first_name, c.last_name].filter(Boolean).join(' ') ||
    c.email ||
    null;
  const company = c.default_address?.company ?? null;

  const defaultAddr = c.default_address;
  const shippingAddress = defaultAddr?.address1
    ? {
        address1: defaultAddr.address1 ?? '',
        address2: defaultAddr.address2 ?? '',
        city: defaultAddr.city ?? '',
        province: defaultAddr.province_code ?? defaultAddr.province ?? '',
        postalCode: defaultAddr.zip ?? '',
        country: defaultAddr.country_code ?? defaultAddr.country ?? 'CA',
      }
    : undefined;

  await prisma.shopifyCustomer.upsert({
    where: { shopifyGid },
    create: {
      shopifyGid,
      displayName,
      email: c.email ?? null,
      phone: c.phone ?? null,
      company,
      shippingAddress: shippingAddress ?? undefined,
      syncedAt: new Date(),
    },
    update: {
      displayName,
      email: c.email ?? null,
      phone: c.phone ?? null,
      company,
      shippingAddress: shippingAddress ?? undefined,
      syncedAt: new Date(),
    },
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const hmac = request.headers.get('x-shopify-hmac-sha256') ?? '';
  if (!verifyHmac(rawBody, hmac)) {
    console.warn('[webhook/shopify] HMAC verification failed');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const topic = request.headers.get('x-shopify-topic') ?? '';
  console.log(`[webhook/shopify] Received topic=${topic}`);

  try {
    const payload = JSON.parse(rawBody);

    if (topic === 'orders/create' || topic === 'orders/updated') {
      const node = restOrderToNode(payload);
      const shopifyAdminClient = isShopifyAdminEnvConfigured()
        ? createShopifyAdminGraphqlClient(getShopifyAdminEnv())
        : undefined;
      await syncOneOrder(node, shopifyAdminClient);
      console.log(`[webhook/shopify] Synced order ${node.name}`);
    } else if (topic === 'customers/update') {
      await syncCustomerFromWebhook(payload);
      console.log(`[webhook/shopify] Synced customer ${payload.id}`);
    } else if (
      topic === 'fulfillments/create' ||
      topic === 'fulfillments/update'
    ) {
      const orderId = payload.order_id;
      if (orderId) {
        const gid = `gid://shopify/Order/${orderId}`;
        const status = payload.status
          ? String(payload.status).toUpperCase()
          : null;

        if (status) {
          const fulfillmentMap: Record<string, string> = {
            SUCCESS: 'FULFILLED',
            PARTIAL: 'PARTIALLY_FULFILLED',
            PENDING: 'PENDING_FULFILLMENT',
            OPEN: 'OPEN',
            CANCELLED: 'UNFULFILLED',
            FAILURE: 'UNFULFILLED',
          };
          const displayStatus = fulfillmentMap[status] ?? status;

          await prisma.shopifyOrder.updateMany({
            where: { shopifyGid: gid },
            data: {
              displayFulfillmentStatus: displayStatus,
              syncedAt: new Date(),
            },
          });
          const localOrder = await prisma.shopifyOrder.findFirst({
            where: { shopifyGid: gid },
            select: { id: true },
          });
          if (localOrder) {
            await recomputePurchaseOrderStatusesForShopifyOrderId(localOrder.id);
          }
          console.log(
            `[webhook/shopify] Updated fulfillment status for order ${orderId} → ${displayStatus}`,
          );
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[webhook/shopify] Error processing webhook:', err);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 },
    );
  }
}
