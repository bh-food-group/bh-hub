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

  const record = await prisma.shopifyCustomer.upsert({
    where: { shopifyGid: cust.id },
    create: {
      shopifyGid: cust.id,
      displayName: cust.displayName,
      email: cust.email,
      phone: cust.phone,
      company,
      shippingAddress: shippingFromShopify ?? undefined,
      billingAddress: billingFromShopify ?? undefined,
      billingSameAsShipping: false,
      syncedAt: new Date(),
    },
    update: {
      displayName: cust.displayName,
      email: cust.email,
      phone: cust.phone,
      company,
      shippingAddress: shippingFromShopify ?? undefined,
      billingAddress: billingFromShopify ?? undefined,
      syncedAt: new Date(),
    },
  });

  return record.id;
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

  await prisma.shopifyCustomer.upsert({
    where: { shopifyGid: node.id },
    create: {
      shopifyGid: node.id,
      displayName,
      email: node.email,
      phone: node.phone,
      company,
      shippingAddress: shippingFromShopify ?? undefined,
      billingSameAsShipping: true,
      syncedAt: new Date(),
    },
    update: {
      displayName,
      email: node.email,
      phone: node.phone,
      company,
      syncedAt: new Date(),
      ...(shippingFromShopify !== null ? { shippingAddress: shippingFromShopify } : {}),
    },
  });
}

/**
 * Upsert a Shopify order + its line items into local DB.
 * Replaces line items on every call (delete + re-create) to stay in sync.
 */
export async function upsertShopifyOrder(
  order: ShopifyOrderNode,
  customerId: string | null,
): Promise<{ id: string; shopifyGid: string }> {
  const shopifyOrder = await prisma.shopifyOrder.upsert({
    where: { shopifyGid: order.id },
    create: {
      shopifyGid: order.id,
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
      syncedAt: new Date(),
    },
    update: {
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
      syncedAt: new Date(),
    },
  });

  const lineItems = order.lineItems.edges.map((e) => e.node);
  const gids = lineItems.map((li) => li.id);

  await Promise.all(
    lineItems.map((li) => {
      const imageUrl = lineItemImageUrlFromShopifyNode(li);
      const qty = effectiveAdminGraphqlLineItemQuantity(li);
      const productGid =
        li.variant?.product?.id?.trim() ||
        li.product?.id?.trim() ||
        null;
      return prisma.shopifyOrderLineItem.upsert({
        where: { shopifyGid: li.id },
        create: {
          shopifyGid: li.id,
          orderId: shopifyOrder.id,
          title: li.title,
          sku: li.sku ?? li.variant?.sku ?? null,
          variantTitle: li.variant?.title ?? null,
          productGid,
          variantGid: li.variant?.id ?? null,
          imageUrl,
          vendor: li.vendor ?? null,
          quantity: qty,
          price: toDecimalOrNull(li.discountedUnitPriceSet?.shopMoney?.amount),
          unitCost: toDecimalOrNull(li.variant?.inventoryItem?.unitCost?.amount),
        },
        update: {
          orderId: shopifyOrder.id,
          title: li.title,
          sku: li.sku ?? li.variant?.sku ?? null,
          variantTitle: li.variant?.title ?? null,
          productGid,
          variantGid: li.variant?.id ?? null,
          imageUrl,
          vendor: li.vendor ?? null,
          quantity: qty,
          price: toDecimalOrNull(li.discountedUnitPriceSet?.shopMoney?.amount),
          unitCost: toDecimalOrNull(li.variant?.inventoryItem?.unitCost?.amount),
        },
      });
    }),
  );

  const removeWhere =
    gids.length > 0
      ? { orderId: shopifyOrder.id, shopifyGid: { notIn: gids } }
      : { orderId: shopifyOrder.id };

  const toRemove = await prisma.shopifyOrderLineItem.findMany({
    where: removeWhere,
    select: { id: true },
  });
  const removeIds = toRemove.map((r) => r.id);
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

  return { id: shopifyOrder.id, shopifyGid: shopifyOrder.shopifyGid };
}

/**
 * Full pipeline: upsert customer → upsert order + line items.
 * When `shopifyAdminClient` is provided, also fetches FulfillmentOrder location data
 * and writes shopifyLocationGid onto each line item.
 */
export async function syncOneOrder(
  order: ShopifyOrderNode,
  shopifyAdminClient?: AdminApiClient,
): Promise<{ id: string; shopifyGid: string }> {
  const customerId = await upsertShopifyCustomer(order);
  const result = await upsertShopifyOrder(order, customerId);

  if (shopifyAdminClient) {
    const locationMap = await fetchFulfillmentOrderLocations(shopifyAdminClient, order.id);
    if (locationMap.size > 0) {
      await Promise.all(
        Array.from(locationMap.entries()).map(([shopifyGid, locationGid]) =>
          prisma.shopifyOrderLineItem.updateMany({
            where: { shopifyGid, orderId: result.id },
            data: { shopifyLocationGid: locationGid },
          }),
        ),
      );
    }
  }

  return result;
}
