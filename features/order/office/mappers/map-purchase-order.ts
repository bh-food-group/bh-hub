/**
 * Mapping layer: Prisma query results → UI view-model types used by Office components.
 *
 * Uses the new Shopify-first schema: fulfillment status comes from
 * ShopifyOrder.displayFulfillmentStatus stored in DB, not from live API calls.
 */

import type { Prisma } from '@prisma/client';
import type { ShopifyOrderDisplayFulfillmentStatus } from '@/types/shopify';
import type {
  OfficePurchaseOrderBlock,
  PoLineItemView,
  PoPanelMeta,
  PoDeliveryLocationPresetSummary,
  PurchaseOrderStatus,
  LinkedShopifyOrder,
  PoEmailDeliveryItem,
} from '../types';
import { derivePurchaseOrderStatusFromShopify } from '@/lib/order/purchase-order-status-compute';
import { legacyFallbackOrderChannel } from '@/lib/order/supplier-order-channel';
import { sortPoLineItemsByProductTitleAsc } from '../utils/sort-lines-by-product-title';
import { minExpectedDateYmdFromShopifyOrders } from '@/lib/order/min-expected-date-ymd-from-shopify-orders';
import { toOrderedAtIso } from '../utils/vancouver-datetime';
import { computeEmailDeliveryOutstanding } from '../utils/po-email-delivery-policy';

/** Use on every Prisma load that feeds `mapPrismaPoToBlock` / `mapPrismaPoToSlimBlock`. */
export const prismaPoCreatedByInclude = {
  select: { id: true, name: true, email: true },
} as const;

// ─── Prisma payload types ─────────────────────────────────────────────────────

export type PrismaPoWithRelations = Prisma.PurchaseOrderGetPayload<{
  include: {
    lineItems: {
      include: {
        shopifyOrderLineItem: true;
      };
    };
    shopifyOrders: { include: { customer: true } };
    supplier: true;
    emailDeliveries: true;
    createdBy: typeof prismaPoCreatedByInclude;
    deliveryLocationPreset: {
      include: {
        locations: {
          select: { id: true; code: true; name: true };
          orderBy: { code: 'asc' };
        };
      };
    };
  };
}>;

/** Slim variant — no lineItems, uses _count for total. Use with mapPrismaPoToSlimBlock. */
export type PrismaPoSlimWithRelations = Prisma.PurchaseOrderGetPayload<{
  include: {
    _count: { select: { lineItems: true } };
    shopifyOrders: { include: { customer: true } };
    supplier: true;
    emailDeliveries: true;
    createdBy: typeof prismaPoCreatedByInclude;
    deliveryLocationPreset: {
      include: {
        locations: {
          select: { id: true; code: true; name: true };
          orderBy: { code: 'asc' };
        };
      };
    };
  };
}>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decimalToString(d: Prisma.Decimal | null | undefined): string | null {
  if (d == null) return null;
  return typeof d === 'object' && 'toFixed' in d
    ? (d as Prisma.Decimal).toFixed(2)
    : String(d);
}

function dateToIso(d: Date | null | undefined): string | null {
  if (d == null) return null;
  try {
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

export const derivePurchaseOrderStatus = derivePurchaseOrderStatusFromShopify;

function mapPoCreatedBy(
  user: PrismaPoWithRelations['createdBy'],
): PoPanelMeta['createdBy'] {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name?.trim() ? user.name.trim() : null,
    email: user.email?.trim() ? user.email.trim() : null,
  };
}

function mapDeliveryLocationPresetSummary(
  preset:
    | PrismaPoWithRelations['deliveryLocationPreset']
    | PrismaPoSlimWithRelations['deliveryLocationPreset'],
): PoDeliveryLocationPresetSummary | null {
  if (!preset) return null;
  const codes = preset.locations.map((l) => l.code);
  return {
    id: preset.id,
    name: preset.name,
    locationCodes: codes,
  };
}

type PrismaShopifyOrderRowForPo =
  | PrismaPoWithRelations['shopifyOrders'][number]
  | PrismaPoSlimWithRelations['shopifyOrders'][number];

function mapShopifyOrderRowToLinkedOrder(
  o: PrismaShopifyOrderRowForPo,
): LinkedShopifyOrder {
  const c = o.customer;
  return {
    id: o.id,
    name: o.name,
    customerName: c?.displayName ?? c?.email ?? null,
    fulfillmentStatus: o.displayFulfillmentStatus,
    customerNote: o.customerNote?.trim() ? o.customerNote.trim() : null,
    displayNameOverride: c?.displayNameOverride?.trim() || null,
    customerCompany: c?.company?.trim() || null,
    customerDisplayName: c?.displayName?.trim() || null,
    customerEmail: (c?.email ?? o.email)?.trim() || null,
    officePoAccountCode: c?.officePoAccountCode?.trim() || null,
  };
}

/** Minimal PO payload for mapping `lineItems` the same way as `mapPrismaPoToBlock`. */
export type PrismaPayloadForPoLineItemViews = {
  status: string;
  completedAt: Date | null;
  lineItems: Prisma.PurchaseOrderLineItemGetPayload<{
    include: { shopifyOrderLineItem: true };
  }>[];
  shopifyOrders: {
    id: string;
    name: string;
    displayFulfillmentStatus: string | null;
  }[];
};

/**
 * Maps PO line rows for the office UI (same rules as `mapPrismaPoToBlock` lineItems).
 * Used by the slim PO list + lazy `GET …/line-items` so we avoid loading supplier,
 * emailDeliveries, and full customer graphs.
 */
export function mapPrismaPayloadToPoLineItemViews(
  po: PrismaPayloadForPoLineItemViews,
  variantImageFallback?: Map<string, string | null>,
  replacementQtyByLineId?: Map<string, number>,
): PoLineItemView[] {
  const storedStatus = po.status as PurchaseOrderStatus;
  const linkedOrders = po.shopifyOrders;
  const firstOrder = linkedOrders[0];
  const firstOrderName = firstOrder?.name ?? '—';

  const orderById = new Map(linkedOrders.map((o) => [o.id, o]));

  const derivedFromShopify = derivePurchaseOrderStatusFromShopify(
    linkedOrders.map((o) => ({
      displayFulfillmentStatus: o.displayFulfillmentStatus,
    })),
    po.completedAt,
  );

  const poConsideredFulfilled =
    derivedFromShopify === 'fulfilled' ||
    derivedFromShopify === 'completed' ||
    storedStatus === 'fulfilled' ||
    storedStatus === 'completed';

  function lineFulfillmentStatus(
    li: (typeof po.lineItems)[0],
  ): ShopifyOrderDisplayFulfillmentStatus {
    const qty = li.quantity;
    const recv = li.quantityReceived;
    if (qty <= 0) return 'FULFILLED';
    if (qty > 0 && recv >= qty) return 'FULFILLED';
    if (qty > 0 && recv > 0 && recv < qty) return 'PARTIALLY_FULFILLED';
    // Hub-only / custom lines (no FK to shopify_order_line_items): never infer
    // "fulfilled" from linked Shopify order state — they must be received in-hub.
    if (poConsideredFulfilled && qty > 0 && li.shopifyOrderLineItemId) {
      return 'FULFILLED';
    }
    return 'UNFULFILLED';
  }

  return sortPoLineItemsByProductTitleAsc(
    po.lineItems.map((li) => {
      const soli = li.shopifyOrderLineItem;
      const owningOrder = soli
        ? (orderById.get(soli.orderId) ??
          linkedOrders.find((o) => o.id === soli.orderId))
        : undefined;
      return {
        id: li.id,
        purchaseOrderId: li.purchaseOrderId,
        sequence: li.sequence,
        quantity: li.quantity,
        quantityReceived: li.quantityReceived,
        supplierRef: li.supplierRef,
        sku: li.sku,
        variantTitle: li.variantTitle,
        productTitle: li.productTitle,
        imageUrl:
          soli?.imageUrl ??
          (li.shopifyVariantGid
            ? (variantImageFallback?.get(li.shopifyVariantGid) ?? null)
            : null),
        isCustom: li.isCustom,
        itemPrice: decimalToString(li.itemPrice),
        itemCost: decimalToString(soli?.unitCost ?? null),
        shopifyOrderLineItemId: soli?.id ?? null,
        shopifyLineItemGid: soli?.shopifyGid ?? null,
        shopifyVariantGid: li.shopifyVariantGid ?? soli?.variantGid ?? null,
        shopifyProductGid: li.shopifyProductGid ?? soli?.productGid ?? null,
        shopifyOrderId: soli?.orderId ?? null,
        shopifyOrderNumber: owningOrder?.name ?? firstOrderName,
        fulfillmentStatus: lineFulfillmentStatus(li),
        note: li.note?.trim() ? li.note.trim() : null,
        replacementQty: replacementQtyByLineId?.get(li.id) ?? 0,
      };
    }),
  );
}

// ─── PO → OfficePurchaseOrderBlock ────────────────────────────────────────────

export function mapPrismaPoToBlock(
  po: PrismaPoWithRelations,
  variantImageFallback?: Map<string, string | null>,
  replacementOrderCount = 0,
): OfficePurchaseOrderBlock {
  const storedStatus = po.status as PurchaseOrderStatus;
  const linkedOrders = po.shopifyOrders;

  const supplierChannel = legacyFallbackOrderChannel({
    orderChannelType: po.supplier?.orderChannelType ?? 'email',
    orderChannelPayload: po.supplier?.orderChannelPayload ?? null,
    contactEmails: po.supplier?.contactEmails ?? [],
    contactName: po.supplier?.contactName ?? null,
    link: po.supplier?.link ?? null,
    notes: po.supplier?.notes ?? null,
  });
  const supplierOrderChannelType = supplierChannel.type;
  const emailDeliveryOutstanding = computeEmailDeliveryOutstanding({
    supplierOrderChannelType,
    emailSentAt: po.emailSentAt,
    archivedAt: po.archivedAt,
    legacyExternalId: po.legacyExternalId,
    emailDeliveryWaivedAt: po.emailDeliveryWaivedAt,
    purchaseOrderStatus: storedStatus,
  });

  const lineItems = mapPrismaPayloadToPoLineItemViews(
    {
      status: po.status,
      completedAt: po.completedAt,
      lineItems: po.lineItems,
      shopifyOrders: po.shopifyOrders.map((o) => ({
        id: o.id,
        name: o.name,
        displayFulfillmentStatus: o.displayFulfillmentStatus,
      })),
    },
    variantImageFallback,
  );

  const orderDates = linkedOrders
    .map((o) => o.processedAt ?? o.shopifyCreatedAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());
  const orderedAt =
    orderDates.length > 0 ? toOrderedAtIso(orderDates[0]) : null;

  const linkedShopifyOrders: LinkedShopifyOrder[] = linkedOrders.map(
    mapShopifyOrderRowToLinkedOrder,
  );

  const minExpectedDateYmd = minExpectedDateYmdFromShopifyOrders(linkedOrders);

  const syncDates = linkedOrders
    .map((o) => o.syncedAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime());
  const lastSyncedAt = syncDates.length > 0 ? syncDates[0].toISOString() : null;

  /** Match PoTable: counts are **line rows** with status FULFILLED, not sum of quantities. */
  const linesFulfilled = lineItems.filter(
    (i) => i.fulfillmentStatus === 'FULFILLED',
  ).length;
  const linesTotal = lineItems.length;

  const panelMeta: PoPanelMeta = {
    poNumber: po.poNumber,
    status: storedStatus,
    currency: po.currency,
    orderedAt,
    dateCreated: dateToIso(po.dateCreated),
    expectedDate: dateToIso(po.expectedDate),
    comment: po.comment?.trim() ? po.comment.trim() : null,
    minExpectedDateYmd,
    fulfillDoneCount: linesFulfilled,
    fulfillPendingCount: linesTotal - linesFulfilled,
    fulfillTotalCount: linesTotal,
    linkedShopifyOrders,
    lastSyncedAt,
    shippingAddress: (po.shippingAddress ??
      null) as PoPanelMeta['shippingAddress'],
    billingAddress: (po.billingAddress ??
      null) as PoPanelMeta['billingAddress'],
    billingSameAsShipping: po.billingSameAsShipping,
    deliveryLocationPreset: mapDeliveryLocationPresetSummary(
      po.deliveryLocationPreset,
    ),
    authorizedBy: po.authorizedBy?.trim() ?? null,
    createdBy: mapPoCreatedBy(po.createdBy),
    emailSentAt: po.emailSentAt ? po.emailSentAt.toISOString() : null,
    emailReplyReceivedAt: po.emailReplyReceivedAt
      ? po.emailReplyReceivedAt.toISOString()
      : null,
    emailDeliveryWaivedAt: po.emailDeliveryWaivedAt
      ? po.emailDeliveryWaivedAt.toISOString()
      : null,
    emailDeliveries: po.emailDeliveries.map(
      (d): PoEmailDeliveryItem => ({
        recipientEmail: d.recipientEmail,
        recipientName: d.recipientName,
        sentAt: d.sentAt.toISOString(),
      }),
    ),
    discount: decimalToString(po.discount),
    discountReason: po.discountReason?.trim() || null,
  };

  return {
    id: po.id,
    poNumber: po.poNumber,
    status: storedStatus,
    currency: po.currency,
    isAuto: po.isAuto,
    title: `Items for PO`,
    shopifyOrderCount: linkedOrders.length,
    lineItems,
    archivedAt: po.archivedAt ? po.archivedAt.toISOString() : null,
    panelMeta,
    supplierOrderChannelType,
    poCreatedAt: po.createdAt.toISOString(),
    legacyExternalId: po.legacyExternalId,
    emailDeliveryOutstanding,
    replacementOrderCount,
  };
}

/**
 * Slim variant of mapPrismaPoToBlock — no lineItems fetched; returns lineItems: []
 * (lazy-loaded client-side). Uses pre-computed lineCounts for panelMeta counts.
 * Keep in sync with mapPrismaPoToBlock when changing shared logic.
 */
export function mapPrismaPoToSlimBlock(
  po: PrismaPoSlimWithRelations,
  lineCounts: { total: number; done: number },
  replacementOrderCount = 0,
): OfficePurchaseOrderBlock {
  const storedStatus = po.status as PurchaseOrderStatus;
  const linkedOrders = po.shopifyOrders;
  const firstOrder = linkedOrders[0];
  const firstOrderName = firstOrder?.name ?? '—';

  const supplierChannel = legacyFallbackOrderChannel({
    orderChannelType: po.supplier?.orderChannelType ?? 'email',
    orderChannelPayload: po.supplier?.orderChannelPayload ?? null,
    contactEmails: po.supplier?.contactEmails ?? [],
    contactName: po.supplier?.contactName ?? null,
    link: po.supplier?.link ?? null,
    notes: po.supplier?.notes ?? null,
  });
  const supplierOrderChannelType = supplierChannel.type;
  const emailDeliveryOutstanding = computeEmailDeliveryOutstanding({
    supplierOrderChannelType,
    emailSentAt: po.emailSentAt,
    archivedAt: po.archivedAt,
    legacyExternalId: po.legacyExternalId,
    emailDeliveryWaivedAt: po.emailDeliveryWaivedAt,
    purchaseOrderStatus: storedStatus,
  });

  const orderById = new Map(linkedOrders.map((o) => [o.id, o]));
  void orderById;

  const linesTotal = lineCounts.total;
  /** Pre-computed on the server — includes Shopify-mirror rules for FK’d lines only. */
  const linesFulfilled = lineCounts.done;

  const orderDates = linkedOrders
    .map((o) => o.processedAt ?? o.shopifyCreatedAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());
  const orderedAt =
    orderDates.length > 0 ? toOrderedAtIso(orderDates[0]) : null;

  const linkedShopifyOrders: LinkedShopifyOrder[] = linkedOrders.map(
    mapShopifyOrderRowToLinkedOrder,
  );

  const minExpectedDateYmd = minExpectedDateYmdFromShopifyOrders(linkedOrders);

  const syncDates = linkedOrders
    .map((o) => o.syncedAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime());
  const lastSyncedAt = syncDates.length > 0 ? syncDates[0].toISOString() : null;

  const panelMeta: PoPanelMeta = {
    poNumber: po.poNumber,
    status: storedStatus,
    currency: po.currency,
    orderedAt,
    dateCreated: dateToIso(po.dateCreated),
    expectedDate: dateToIso(po.expectedDate),
    comment: po.comment?.trim() ? po.comment.trim() : null,
    minExpectedDateYmd,
    fulfillDoneCount: linesFulfilled,
    fulfillPendingCount: linesTotal - linesFulfilled,
    fulfillTotalCount: linesTotal,
    linkedShopifyOrders,
    lastSyncedAt,
    shippingAddress: (po.shippingAddress ??
      null) as PoPanelMeta['shippingAddress'],
    billingAddress: (po.billingAddress ??
      null) as PoPanelMeta['billingAddress'],
    billingSameAsShipping: po.billingSameAsShipping,
    deliveryLocationPreset: mapDeliveryLocationPresetSummary(
      po.deliveryLocationPreset,
    ),
    authorizedBy: po.authorizedBy?.trim() ?? null,
    createdBy: mapPoCreatedBy(po.createdBy),
    emailSentAt: po.emailSentAt ? po.emailSentAt.toISOString() : null,
    emailReplyReceivedAt: po.emailReplyReceivedAt
      ? po.emailReplyReceivedAt.toISOString()
      : null,
    emailDeliveryWaivedAt: po.emailDeliveryWaivedAt
      ? po.emailDeliveryWaivedAt.toISOString()
      : null,
    emailDeliveries: po.emailDeliveries.map(
      (d): PoEmailDeliveryItem => ({
        recipientEmail: d.recipientEmail,
        recipientName: d.recipientName,
        sentAt: d.sentAt.toISOString(),
      }),
    ),
    discount: decimalToString(po.discount),
    discountReason: po.discountReason?.trim() || null,
  };

  return {
    id: po.id,
    poNumber: po.poNumber,
    status: storedStatus,
    currency: po.currency,
    isAuto: po.isAuto,
    title: `Items for PO`,
    shopifyOrderCount: linkedOrders.length,
    lineItems: [],
    archivedAt: po.archivedAt ? po.archivedAt.toISOString() : null,
    panelMeta,
    supplierOrderChannelType,
    poCreatedAt: po.createdAt.toISOString(),
    legacyExternalId: po.legacyExternalId,
    emailDeliveryOutstanding,
    replacementOrderCount,
  };
}

// ─── Utility: format Decimal as display currency ─────────────────────────────

export function formatItemPrice(raw: string | null, currency = 'CAD'): string {
  if (raw == null) return '—';
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n)) return raw;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(n);
  } catch {
    return `${raw} ${currency}`;
  }
}
