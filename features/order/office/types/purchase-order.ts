import type { ShopifyOrderDisplayFulfillmentStatus } from '@/types/shopify';
import type { SupplierOrderChannelType } from '@/lib/order/supplier-order-channel';

export type PurchaseOrderStatus =
  | 'pending'
  | 'unfulfilled'
  | 'partially_fulfilled'
  | 'fulfilled'
  | 'completed';

export type LineFulfillmentStatus = ShopifyOrderDisplayFulfillmentStatus;

export type PoLineItemView = {
  id: string;
  purchaseOrderId: string;
  sequence: number;
  quantity: number;
  quantityReceived: number;
  supplierRef: string | null;
  sku: string | null;
  variantTitle: string | null;
  productTitle: string | null;
  /** From linked Shopify order line when available. */
  imageUrl?: string | null;
  isCustom: boolean;
  itemPrice: string | null;
  /** Unit cost from source Shopify variant inventory when available. */
  itemCost?: string | null;
  /** Local `ShopifyOrderLineItem.id` when line is tied to a synced Shopify line. */
  shopifyOrderLineItemId?: string | null;
  shopifyLineItemGid?: string | null;
  shopifyVariantGid?: string | null;
  shopifyProductGid?: string | null;
  /** Local `ShopifyOrder.id` for the source customer order. */
  shopifyOrderId?: string | null;
  shopifyOrderNumber: string;
  fulfillmentStatus: LineFulfillmentStatus;
  /** PO / PDF line note (editable per PO; defaults from Item settings mapping). */
  note: string | null;
  /** Total qty sent to custom orders from this PO line (hub-only, never touches Shopify). */
  customOrderQty?: number;
};

export type LinkedShopifyOrder = {
  id: string;
  name: string;
  /** Compact label for badges (Shopify display name, else order email). */
  customerName: string | null;
  fulfillmentStatus: string | null;
  /** Shopify `Order.note` synced to DB (`shopify_orders.customer_note`). */
  customerNote: string | null;
  /** Hub Customer Settings — local display name override (not synced to Shopify). */
  displayNameOverride: string | null;
  customerCompany: string | null;
  customerDisplayName: string | null;
  customerEmail: string | null;
  officePoAccountCode: string | null;
};

export type PoAddress = {
  address1: string;
  address2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
};

export type PoEmailDeliveryItem = {
  recipientEmail: string;
  recipientName: string | null;
  sentAt: string;
};

/** Linked `public.delivery_location_presets` row when PO ship-to was chosen from a preset. */
export type PoDeliveryLocationPresetSummary = {
  id: string;
  name: string;
  /** `Location.code` values for locations that reference this preset (may be many). */
  locationCodes: string[];
};

export type PoPanelMeta = {
  poNumber: string;
  status: PurchaseOrderStatus;
  currency: string;
  orderedAt: string | null;
  dateCreated: string | null;
  expectedDate: string | null;
  /** PO note (`purchase_orders.comment`) — office UI + printed / emailed PO PDF. */
  comment: string | null;
  /**
   * Vancouver `YYYY-MM-DD` — earliest allowed expected delivery (latest Shopify order placement
   * day among linked orders). Null when no linked orders or placement dates unknown.
   */
  minExpectedDateYmd: string | null;
  fulfillDoneCount: number;
  fulfillPendingCount: number;
  fulfillTotalCount: number;
  linkedShopifyOrders: LinkedShopifyOrder[];
  lastSyncedAt: string | null;
  shippingAddress: PoAddress | null;
  billingAddress: PoAddress | null;
  billingSameAsShipping: boolean;
  deliveryLocationPreset: PoDeliveryLocationPresetSummary | null;
  authorizedBy: string | null;
  /** Hub user who created this PO; null for legacy CSV import or missing data. */
  createdBy: { id: string; name: string | null; email: string | null } | null;
  emailSentAt: string | null;
  emailReplyReceivedAt: string | null;
  /** ISO — user chose not to send hub email; reminders suppressed until cleared or send logged. */
  emailDeliveryWaivedAt: string | null;
  emailDeliveries: PoEmailDeliveryItem[];
};

export type OfficePurchaseOrderBlock = {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  currency: string;
  isAuto: boolean;
  title: string;
  shopifyOrderCount: number;
  lineItems: PoLineItemView[];
  subtreeRowLabel?: string;
  /** ISO — when set, PO is archived and ignored for open-delivery / inbox tab logic. */
  archivedAt?: string | null;
  panelMeta?: PoPanelMeta;
  /** Resolved supplier channel (legacy fallback applied in mapper). */
  supplierOrderChannelType: SupplierOrderChannelType;
  /** DB `purchase_orders.created_at` (ISO). */
  poCreatedAt: string;
  /** Shopify export `ID` when PO was imported from CSV; skips email-delivery nagging. */
  legacyExternalId: number | null;
  /** Email-channel PO, not archived/import legacy, no `emailSentAt`. */
  emailDeliveryOutstanding: boolean;
  /** Count of active (non-archived) custom orders created from this PO. */
  customOrderCount: number;
};

/** Shopify placeholder when a product has only the default variant. */
const SHOPIFY_DEFAULT_VARIANT_TITLE_LC = 'default title';

/** True when `variantTitle` should be shown as a distinct variant (not Shopify's default). */
export function isMeaningfulVariantTitle(
  variantTitle: string | null | undefined,
): boolean {
  const t = variantTitle?.trim();
  if (!t) return false;
  return t.toLowerCase() !== SHOPIFY_DEFAULT_VARIANT_TITLE_LC;
}

/** Single-line product label: appends variant only when it is not the default variant title. */
export function mergeProductAndVariantTitle(
  productTitle: string,
  variantTitle: string | null | undefined,
): string {
  if (!isMeaningfulVariantTitle(variantTitle)) return productTitle;
  return `${productTitle} — ${variantTitle!.trim()}`;
}

export function formatProductLabel(line: PoLineItemView): string {
  return mergeProductAndVariantTitle(line.productTitle ?? '(untitled)', line.variantTitle);
}
