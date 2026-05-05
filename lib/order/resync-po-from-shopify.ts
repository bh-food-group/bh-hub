/**
 * After a Shopify order sync, refresh `PurchaseOrderLineItem` rows that point at
 * `ShopifyOrderLineItem` records, and optionally append new PO lines for unlinked
 * lines on a chosen linked Shopify order.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/prisma';
import {
  detachPoLinesForFulfilledFinanciallyCanceledShopifyOrder,
  shouldDetachPoLinesAfterFulfilledOrderFinanciallyCanceled,
} from '@/lib/order/detach-po-lines-for-fulfilled-financially-canceled-shopify-order';
import { deletePurchaseOrderLineItemIfNoFinalizedFulfillments } from '@/lib/order/purchase-order-line-item-delete-if-safe';
import { recomputePurchaseOrderStatusById } from '@/lib/order/purchase-order-status';
import { loadVariantOfficeNotesMap } from '@/lib/order/shopify-variant-office-note';

export type ResyncPurchaseOrderFromShopifyOptions = {
  purchaseOrderId: string;
  /** Local `ShopifyOrder.id` — only lines on this order are considered for append. */
  appendFromShopifyOrderId?: string | null;
};

function toDecimal(
  n: Prisma.Decimal | number | null | undefined,
): Prisma.Decimal | null {
  if (n == null) return null;
  if (n instanceof Prisma.Decimal) return n;
  return new Prisma.Decimal(n);
}

export async function resyncPurchaseOrderLineItemsFromShopify(
  options: ResyncPurchaseOrderFromShopifyOptions,
): Promise<void> {
  const { purchaseOrderId, appendFromShopifyOrderId } = options;

  const poInitial = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: {
      supplier: { select: { shopifyVendorName: true } },
      lineItems: { orderBy: { sequence: 'asc' } },
      shopifyOrders: {
        select: {
          id: true,
          displayFulfillmentStatus: true,
          displayFinancialStatus: true,
        },
      },
    },
  });
  if (!poInitial) return;

  const touchedByDetach = new Set<string>();
  const detachResults = await Promise.all(
    poInitial.shopifyOrders.map((o) =>
      detachPoLinesForFulfilledFinanciallyCanceledShopifyOrder(
        o.id,
        o.displayFulfillmentStatus,
        o.displayFinancialStatus,
      ),
    ),
  );
  for (const ids of detachResults) {
    for (const id of ids) touchedByDetach.add(id);
  }
  await Promise.all(
    [...touchedByDetach].map((id) => recomputePurchaseOrderStatusById(id)),
  );

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: {
      supplier: { select: { shopifyVendorName: true } },
      lineItems: { orderBy: { sequence: 'asc' } },
      shopifyOrders: { select: { id: true } },
    },
  });
  if (!po) return;

  const linkedOrderIds = new Set(po.shopifyOrders.map((o) => o.id));
  const vendorNorm =
    po.supplier.shopifyVendorName?.trim().toLowerCase() ?? null;

  const linkedSoliIds = po.lineItems
    .map((l) => l.shopifyOrderLineItemId)
    .filter((id): id is string => Boolean(id));
  const soliRows =
    linkedSoliIds.length > 0
      ? await prisma.shopifyOrderLineItem.findMany({
          where: { id: { in: linkedSoliIds } },
        })
      : [];
  const soliById = new Map(soliRows.map((s) => [s.id, s]));

  await Promise.all(
    po.lineItems.map(async (poli) => {
      if (!poli.shopifyOrderLineItemId) return;
      const soli = soliById.get(poli.shopifyOrderLineItemId) ?? null;
      if (!soli) {
        await deletePurchaseOrderLineItemIfNoFinalizedFulfillments(poli.id);
        return;
      }
      if (!linkedOrderIds.has(soli.orderId)) {
        return;
      }

      const price = soli.price;
      const qty = soli.quantity;
      const subtotal =
        price != null ? new Prisma.Decimal(price).mul(qty) : null;

      await prisma.purchaseOrderLineItem.update({
        where: { id: poli.id },
        data: {
          quantity: qty,
          sku: soli.sku,
          variantTitle: soli.variantTitle,
          productTitle: soli.title,
          itemPrice: price,
          lineSubtotalPrice: subtotal,
          shopifyVariantGid: soli.variantGid,
          isCustom: !soli.variantGid,
        },
      });
    }),
  );

  if (
    !appendFromShopifyOrderId ||
    !linkedOrderIds.has(appendFromShopifyOrderId)
  ) {
    await recomputePurchaseOrderStatusById(purchaseOrderId);
    return;
  }

  const refreshed = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: {
      lineItems: { orderBy: { sequence: 'asc' } },
    },
  });
  if (!refreshed) {
    await recomputePurchaseOrderStatusById(purchaseOrderId);
    return;
  }

  const usedShopifyLineIds = new Set(
    refreshed.lineItems
      .map((l) => l.shopifyOrderLineItemId)
      .filter(Boolean) as string[],
  );

  const orderWithLines = await prisma.shopifyOrder.findUnique({
    where: { id: appendFromShopifyOrderId },
    include: { lineItems: { orderBy: { createdAt: 'asc' } } },
  });
  if (!orderWithLines) {
    await recomputePurchaseOrderStatusById(purchaseOrderId);
    return;
  }

  if (
    shouldDetachPoLinesAfterFulfilledOrderFinanciallyCanceled({
      displayFulfillmentStatus: orderWithLines.displayFulfillmentStatus,
      displayFinancialStatus: orderWithLines.displayFinancialStatus,
    })
  ) {
    await recomputePurchaseOrderStatusById(purchaseOrderId);
    return;
  }

  const baseSeq = refreshed.lineItems.reduce(
    (m, l) => Math.max(m, l.sequence),
    0,
  );

  const appendCandidates = orderWithLines.lineItems.filter((li) => {
    if (li.quantity <= 0) return false;
    if (usedShopifyLineIds.has(li.id)) return false;
    if (vendorNorm) {
      const v = li.vendor?.trim().toLowerCase() ?? '';
      if (v && v !== vendorNorm) return false;
    }
    return true;
  });
  const appendVariantGids = appendCandidates
    .map((li) => li.variantGid?.trim())
    .filter((g): g is string => Boolean(g));
  const noteByVariant = await loadVariantOfficeNotesMap(
    prisma,
    appendVariantGids,
  );

  const appendRows = appendCandidates.map((li, idx) => {
    const price = li.price;
    const subtotal =
      price != null ? new Prisma.Decimal(price).mul(li.quantity) : null;
    const vg = li.variantGid?.trim() ?? null;
    const defaultNote = vg ? (noteByVariant.get(vg) ?? null) : null;
    return {
      purchaseOrderId,
      sequence: baseSeq + idx + 1,
      quantity: li.quantity,
      quantityReceived: 0,
      sku: li.sku,
      variantTitle: li.variantTitle,
      productTitle: li.title ?? '(untitled)',
      shopifyOrderLineItemId: li.id,
      shopifyVariantGid: li.variantGid,
      isCustom: !li.variantGid,
      itemPrice: toDecimal(price),
      lineSubtotalPrice: subtotal,
      note: defaultNote,
    };
  });
  if (appendRows.length > 0) {
    await prisma.purchaseOrderLineItem.createMany({ data: appendRows });
  }

  await recomputePurchaseOrderStatusById(purchaseOrderId);
}
