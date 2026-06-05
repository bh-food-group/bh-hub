import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import {
  parseBody,
  shopifyOrderCreateBodySchema,
  type ShopifyOrderCreateBody,
} from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import { getShopifyAdminEnv, isShopifyAdminEnvConfigured } from '@/lib/shopify/env';
import { createShopifyOrder } from '@/lib/shopify/createShopifyOrder';
import type {
  CreateShopifyOrderMailingInput,
  CreateShopifyOrderParams,
} from '@/lib/shopify/createShopifyOrder';
import { fetchShopifyOrderNodeByGid } from '@/lib/shopify/fetchOrders';
import { syncOneOrder } from '@/lib/shopify/sync/upsert-order';
import { prisma } from '@/lib/core/prisma';

function trimOrUndef(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t && t.length > 0 ? t : undefined;
}

function mailingFromBody(
  row: ShopifyOrderCreateBody['shippingAddress'],
): CreateShopifyOrderMailingInput {
  return {
    address1: row.address1.trim(),
    address2: row.address2?.trim() || undefined,
    city: row.city.trim(),
    zip: row.zip.trim(),
    countryCode: row.countryCode,
    provinceCode: trimOrUndef(row.provinceCode),
    company: trimOrUndef(row.company),
    phone: trimOrUndef(row.phone),
    firstName: trimOrUndef(row.firstName),
    lastName: trimOrUndef(row.lastName),
  };
}

export async function POST(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    if (!isShopifyAdminEnvConfigured()) {
      return NextResponse.json(
        { error: 'Shopify Admin API is not configured on the server.' },
        { status: 503 },
      );
    }

    const parsed = await parseBody(request, shopifyOrderCreateBodySchema);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;

    const creds = getShopifyAdminEnv();

    const params: CreateShopifyOrderParams = {
      customerShopifyGid: body.customerShopifyGid,
      shippingAddress: mailingFromBody(body.shippingAddress),
      billingAddress: body.billingAddress
        ? mailingFromBody(body.billingAddress)
        : undefined,
      lineItems: body.lineItems.map((li) =>
        li.kind === 'variant'
          ? { kind: 'variant', variantGid: li.variantGid, quantity: li.quantity }
          : {
              kind: 'custom',
              title: li.title,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              unitCost: li.unitCost ?? 0,
              taxable: li.taxable ?? true,
            },
      ),
      deliveryMethod: body.deliveryMethod,
      shippingFee: body.shippingFee,
      financialStatus: body.financialStatus,
      note: body.note ?? null,
    };

    const { orderGid } = await createShopifyOrder(creds, params);

    const node = await fetchShopifyOrderNodeByGid(creds, orderGid, {
      lineItems: 'sync',
    });
    if (!node) {
      return NextResponse.json(
        {
          error:
            'Order was created in Shopify but could not be loaded for sync. Run a Shopify sync.',
        },
        { status: 502 },
      );
    }

    // syncOneOrder resolves the FulfillmentOrder location → shopifyLocationGid
    // internally (builds its own admin client), so vendor+location supplier
    // mappings resolve immediately instead of landing under "Unassigned".
    const synced = await syncOneOrder(node);

    // Patch unitCost for custom line items — Shopify has no cost field for non-variant items.
    // Match input custom items to synced line items by position (same creation order).
    const inputCustomItems = params.lineItems.filter(
      (li): li is Extract<typeof li, { kind: 'custom' }> =>
        li.kind === 'custom' && (li.unitCost ?? 0) > 0,
    );
    if (inputCustomItems.length > 0) {
      // node.lineItems preserves Shopify's order — custom items have variant === null
      const customLineGids = node.lineItems.edges
        .filter((e) => e.node.variant === null)
        .map((e) => e.node.id);

      await Promise.all(
        inputCustomItems.map((li, i) => {
          const gid = customLineGids[i];
          if (!gid) return null;
          return prisma.shopifyOrderLineItem.updateMany({
            where: { shopifyGid: gid, orderId: synced.id },
            data: { unitCost: li.unitCost },
          });
        }),
      );
    }

    return NextResponse.json({
      ok: true,
      shopifyOrderId: synced.id,
      shopifyGid: synced.shopifyGid,
      name: node.name ?? null,
    });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'POST /api/shopify/orders/create');
  }
}
