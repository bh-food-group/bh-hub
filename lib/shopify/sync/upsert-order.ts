/**
 * Shared upsert logic for syncing a single Shopify order (+ customer + line items)
 * into local DB tables. Used by both the incremental sync API and webhook handler.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/prisma';
import type { ShopifyMailingAddress, ShopifyOrderNode } from '@/types/shopify';
import type { ShopifyAdminCustomerNode } from '@/lib/shopify/fetchCustomers';
import { lineItemImageUrlFromShopifyNode } from '@/lib/shopify/line-item-image-url';
import { effectiveAdminGraphqlLineItemQuantity } from '@/lib/shopify/line-item-effective-quantity';
import { detachPoLinesForFulfilledFinanciallyCanceledShopifyOrder } from '@/lib/order/detach-po-lines-for-fulfilled-financially-canceled-shopify-order';
import {
  recomputePurchaseOrderStatusById,
  recomputePurchaseOrderStatusesForShopifyOrderId,
} from '@/lib/order/purchase-order-status';
import type { AdminApiClient } from '@shopify/admin-api-client';
import { fetchFulfillmentOrderLocations } from '@/lib/shopify/fetchFulfillmentOrderLocations';
import { createShopifyAdminGraphqlClient } from '@/lib/shopify/createFulfillment';
import { getShopifyAdminEnv, isShopifyAdminEnvConfigured } from '@/lib/shopify/env';
import { valuesDiffer } from './sync-diff';

function parseOrderNumber(name: string | null): number {
  if (!name) return 0;
  const digits = name.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function toDecimalOrNull(
  amount: string | null | undefined,
): Prisma.Decimal | null {
  if (!amount) return null;
  const n = parseFloat(amount);
  return isNaN(n) ? null : new Prisma.Decimal(n);
}

function customerNoteFromShopify(
  note: string | null | undefined,
): string | null {
  if (note == null) return null;
  const t = note.trim();
  return t.length > 0 ? t : null;
}

/** Shopify often omits `province` and only sets `provinceCode` / REST `province_code`. */
function provinceFromMailingAddress(
  addr: Pick<ShopifyMailingAddress, 'province' | 'provinceCode'>,
): string {
  const code = addr.provinceCode?.trim();
  if (code) return code;
  return (addr.province ?? '').trim();
}

function addressToJson(
  addr: ShopifyOrderNode['billingAddress'],
): Prisma.InputJsonValue | undefined {
  if (!addr) return undefined;
  return {
    address1: addr.address1,
    address2: addr.address2,
    city: addr.city,
    province: provinceFromMailingAddress(addr),
    country: addr.country,
    zip: addr.zip,
    company: addr.company,
    name: addr.name,
    phone: addr.phone,
  };
}

/**
 * Convert a Shopify mailing address to the structured JSON stored in
 * `ShopifyCustomer.shippingAddress` / `billingAddress`.
 */
function shopifyAddrToCustomerAddr(
  addr: ShopifyOrderNode['billingAddress'] | null | undefined,
): Prisma.InputJsonValue | null {
  if (!addr || !addr.address1) return null;
  return {
    address1: addr.address1 ?? '',
    address2: addr.address2 ?? '',
    city: addr.city ?? '',
    province: provinceFromMailingAddress(addr),
    postalCode: addr.zip ?? '',
    country: addr.country ?? 'CA',
  };
}

/**
 * Upsert a Shopify customer into `shopify_customers`.
 * Syncs address data from the customer's Shopify `defaultAddress` (if available)
 * into local `shippingAddress`. Order-level `billingAddress` is used for billing.
 * Returns the local DB id, or null if the order has no customer.
 */
export async function upsertShopifyCustomer(
  order: ShopifyOrderNode,
): Promise<string | null> {
  const cust = order.customer;
  if (!cust?.id) return null;

  const company = order.billingAddress?.company ?? null;

  const shippingFromShopify = shopifyAddrToCustomerAddr(
    cust.defaultAddress ?? order.shippingAddress,
  );
  const billingFromShopify = shopifyAddrToCustomerAddr(order.billingAddress);

  // Fields written on update. Excludes `syncedAt` so an unchanged customer is a
  // true no-op (no row rewrite / WAL) — syncedAt is only bumped when something
  // actually changed. See sync-diff.ts.
  const updateData = {
    displayName: cust.displayName,
    email: cust.email,
    phone: cust.phone,
    company,
    shippingAddress: shippingFromShopify ?? undefined,
    billingAddress: billingFromShopify ?? undefined,
  };

  const existing = await prisma.shopifyCustomer.findUnique({
    where: { shopifyGid: cust.id },
    select: {
      id: true,
      displayName: true,
      email: true,
      phone: true,
      company: true,
      shippingAddress: true,
      billingAddress: true,
    },
  });

  if (!existing) {
    const created = await prisma.shopifyCustomer.create({
      data: {
        shopifyGid: cust.id,
        ...updateData,
        billingSameAsShipping: false,
        syncedAt: new Date(),
      },
      select: { id: true },
    });
    return created.id;
  }

  if (valuesDiffer(existing, updateData)) {
    await prisma.shopifyCustomer.update({
      where: { id: existing.id },
      data: { ...updateData, syncedAt: new Date() },
    });
  }

  return existing.id;
}

function pickMailingAddressForCustomer(node: ShopifyAdminCustomerNode): ShopifyMailingAddress | null {
  if (node.defaultAddress?.address1) return node.defaultAddress;
  const first = node.addressesV2?.edges?.[0]?.node;
  if (first?.address1) return first;
  return null;
}

/**
 * Upsert a customer row from the Admin `customers` GraphQL query (incremental
 * customer sync). Does not touch `billingAddress` so office-only billing edits
 * are preserved when Shopify has no separate billing on the customer.
 */
export async function upsertShopifyCustomerFromAdminNode(
  node: ShopifyAdminCustomerNode,
): Promise<void> {
  const displayName =
    node.displayName?.trim() ||
    [node.firstName, node.lastName].filter(Boolean).join(' ') ||
    node.email ||
    null;

  const mail = pickMailingAddressForCustomer(node);
  const company = mail?.company ?? node.defaultAddress?.company ?? null;
  const shippingFromShopify = shopifyAddrToCustomerAddr(mail);

  // Update fields exclude syncedAt so unchanged customers are a no-op. Shipping
  // is only written when Shopify provided one (preserves office-only edits).
  const updateData = {
    displayName,
    email: node.email,
    phone: node.phone,
    company,
    ...(shippingFromShopify !== null ? { shippingAddress: shippingFromShopify } : {}),
  };

  const existing = await prisma.shopifyCustomer.findUnique({
    where: { shopifyGid: node.id },
    select: {
      id: true,
      displayName: true,
      email: true,
      phone: true,
      company: true,
      shippingAddress: true,
    },
  });

  if (!existing) {
    await prisma.shopifyCustomer.create({
      data: {
        shopifyGid: node.id,
        ...updateData,
        billingSameAsShipping: true,
        syncedAt: new Date(),
      },
    });
    return;
  }

  if (valuesDiffer(existing, updateData)) {
    await prisma.shopifyCustomer.update({
      where: { id: existing.id },
      data: { ...updateData, syncedAt: new Date() },
    });
  }
}

/**
 * Upsert a Shopify order + its line items into local DB.
 * Replaces line items on every call (delete + re-create) to stay in sync.
 */
export async function upsertShopifyOrder(
  order: ShopifyOrderNode,
  customerId: string | null,
): Promise<{ id: string; shopifyGid: string }> {
  // Read the existing order (+ its line items) once, then write only what
  // actually changed. Re-upserting unchanged rows on every sync was the main
  // Disk IO source. `syncedAt` is excluded from the diff and only bumped on a
  // real change. See sync-diff.ts.
  const existingOrder = await prisma.shopifyOrder.findUnique({
    where: { shopifyGid: order.id },
    select: {
      id: true,
      name: true,
      orderNumber: true,
      customerId: true,
      email: true,
      displayFulfillmentStatus: true,
      displayFinancialStatus: true,
      currencyCode: true,
      totalPrice: true,
      processedAt: true,
      shopifyCreatedAt: true,
      billingAddress: true,
      shippingAddress: true,
      customerNote: true,
      lineItems: {
        select: {
          id: true,
          shopifyGid: true,
          orderId: true,
          title: true,
          sku: true,
          variantTitle: true,
          productGid: true,
          variantGid: true,
          imageUrl: true,
          vendor: true,
          quantity: true,
          price: true,
          unitCost: true,
        },
      },
    },
  });

  const orderData = {
    name: order.name ?? '',
    orderNumber: parseOrderNumber(order.name),
    customerId,
    email: order.email,
    displayFulfillmentStatus: order.displayFulfillmentStatus,
    displayFinancialStatus: order.displayFinancialStatus,
    currencyCode: order.currencyCode,
    totalPrice: toDecimalOrNull(order.totalPriceSet?.shopMoney?.amount),
    processedAt: order.processedAt ? new Date(order.processedAt) : null,
    shopifyCreatedAt: order.createdAt ? new Date(order.createdAt) : null,
    billingAddress: addressToJson(order.billingAddress),
    shippingAddress: addressToJson(order.shippingAddress),
    customerNote: customerNoteFromShopify(order.note),
  };

  let shopifyOrder: { id: string };
  if (!existingOrder) {
    shopifyOrder = await prisma.shopifyOrder.create({
      data: { shopifyGid: order.id, ...orderData, syncedAt: new Date() },
      select: { id: true },
    });
  } else {
    if (valuesDiffer(existingOrder, orderData)) {
      await prisma.shopifyOrder.update({
        where: { id: existingOrder.id },
        data: { ...orderData, syncedAt: new Date() },
      });
    }
    shopifyOrder = { id: existingOrder.id };
  }

  const lineItems = order.lineItems.edges.map((e) => e.node);
  const gids = lineItems.map((li) => li.id);
  const existingByGid = new Map(
    (existingOrder?.lineItems ?? []).map((li) => [li.shopifyGid, li]),
  );

  await Promise.all(
    lineItems.map((li) => {
      const imageUrl = lineItemImageUrlFromShopifyNode(li);
      const qty = effectiveAdminGraphqlLineItemQuantity(li);
      const productGid =
        li.variant?.product?.id?.trim() ||
        li.product?.id?.trim() ||
        null;
      const existingLi = existingByGid.get(li.id);
      // Custom items (addCustomItem) have no product/variant, and Shopify always
      // returns vendor=null for them. When the hub has stamped a vendor on such a
      // line (to group it under a supplier in the inbox instead of "Unassigned"),
      // preserve it — otherwise every sync would wipe the stamp back to null.
      const isCustomLine = !li.variant?.id && !productGid;
      const vendor =
        li.vendor ?? (isCustomLine ? existingLi?.vendor ?? null : null);
      const liData = {
        orderId: shopifyOrder.id,
        title: li.title,
        sku: li.sku ?? li.variant?.sku ?? null,
        variantTitle: li.variant?.title ?? null,
        productGid,
        variantGid: li.variant?.id ?? null,
        imageUrl,
        vendor,
        quantity: qty,
        price: toDecimalOrNull(li.discountedUnitPriceSet?.shopMoney?.amount),
        unitCost: toDecimalOrNull(li.variant?.inventoryItem?.unitCost?.amount),
      };
      if (!existingLi) {
        return prisma.shopifyOrderLineItem.create({
          data: { shopifyGid: li.id, ...liData },
        });
      }
      if (valuesDiffer(existingLi, liData)) {
        return prisma.shopifyOrderLineItem.update({
          where: { id: existingLi.id },
          data: liData,
        });
      }
      return Promise.resolve();
    }),
  );

  // Line items present locally but no longer on the Shopify order. Computed from
  // the rows we already read — no extra query.
  const desiredGids = new Set(gids);
  const removeIds = (existingOrder?.lineItems ?? [])
    .filter((li) => !desiredGids.has(li.shopifyGid))
    .map((li) => li.id);
  if (removeIds.length > 0) {
    await prisma.purchaseOrderLineItem.updateMany({
      where: { shopifyOrderLineItemId: { in: removeIds } },
      data: { shopifyOrderLineItemId: null },
    });
    await prisma.fulfillmentLineItem.updateMany({
      where: { shopifyOrderLineItemId: { in: removeIds } },
      data: { shopifyOrderLineItemId: null },
    });
    await prisma.shopifyOrderLineItem.deleteMany({
      where: { id: { in: removeIds } },
    });
  }

  const touchedPoIds = await detachPoLinesForFulfilledFinanciallyCanceledShopifyOrder(
    shopifyOrder.id,
    order.displayFulfillmentStatus,
    order.displayFinancialStatus,
  );
  await Promise.all(
    touchedPoIds.map((poId) => recomputePurchaseOrderStatusById(poId)),
  );

  await recomputePurchaseOrderStatusesForShopifyOrderId(shopifyOrder.id);

  return { id: shopifyOrder.id, shopifyGid: order.id };
}

/**
 * Full pipeline: upsert customer → upsert order + line items, then resolve each
 * line item's FulfillmentOrder location → `shopifyLocationGid`. The location is
 * required for vendor+location supplier mappings; without it those orders fall
 * back to vendor-only mapping and land under "Unassigned".
 *
 * Pass `shopifyAdminClient` to reuse a client across orders (bulk sync); when
 * omitted, one is built from env so single-order callers (order create/edit)
 * still resolve the location. If Shopify admin env is not configured, the
 * location step is skipped.
 */
export async function syncOneOrder(
  order: ShopifyOrderNode,
  shopifyAdminClient?: AdminApiClient,
): Promise<{ id: string; shopifyGid: string }> {
  const customerId = await upsertShopifyCustomer(order);
  const result = await upsertShopifyOrder(order, customerId);

  const client =
    shopifyAdminClient ??
    (isShopifyAdminEnvConfigured()
      ? createShopifyAdminGraphqlClient(getShopifyAdminEnv())
      : null);

  if (client) {
    const locationMap = await fetchFulfillmentOrderLocations(client, order.id);
    if (locationMap.size > 0) {
      await Promise.all(
        Array.from(locationMap.entries()).map(([shopifyGid, locationGid]) =>
          prisma.shopifyOrderLineItem.updateMany({
            // Skip unchanged rows so they produce zero writes (no new row version /
            // WAL) — the location rarely changes, so without this every sync re-wrote
            // every line item, a major Disk IO source. The explicit `null` branch is
            // required: `{ not: locationGid }` compiles to `shopify_location_gid <>
            // locationGid`, and in SQL `NULL <> '…'` is NULL (not TRUE), so rows that
            // have never had a location would otherwise never be backfilled — leaving
            // vendor+location lines stuck under the wrong supplier in the inbox.
            where: {
              shopifyGid,
              orderId: result.id,
              OR: [
                { shopifyLocationGid: null },
                { shopifyLocationGid: { not: locationGid } },
              ],
            },
            data: { shopifyLocationGid: locationGid },
          }),
        ),
      );
    }
  }

  return result;
}
