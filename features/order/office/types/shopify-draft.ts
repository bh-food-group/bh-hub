import type { PoAddress } from './purchase-order';

export type PrePoLineDraft = {
  /** Local `ShopifyOrderLineItem.id` for API edits. */
  shopifyLineItemId?: string;
  /** Shopify LineItem GID (`gid://shopify/LineItem/...`). */
  shopifyLineItemGid?: string | null;
  shopifyVariantGid?: string | null;
  /** When known (e.g. search), used for optional catalog price updates. */
  shopifyProductGid?: string | null;
  /** Synced product/variant image URL from Shopify. */
  imageUrl?: string | null;
  sku: string | null;
  productTitle: string;
  itemPrice: string | null;
  /** Variant unit cost from Shopify inventory, when synced. */
  itemCost?: string | null;
  /** Shopify order line qty before subtracting qty already on active POs (Inbox dedupe). */
  shopifySourceLineQty?: number;
  /** Remaining qty for the next PO (≤ `shopifySourceLineQty` when set). */
  quantity: number;
  includeInPo: boolean;
  disabled?: boolean;
  /** Item settings default for this variant (PO/PDF line note); editable in Inbox before PO create. */
  defaultPoLineNote?: string | null;
};

export type ShopifyOrderDraft = {
  id: string;
  /** Hub DB `shopify_orders.archived_at` (ISO); null = not archived. */
  archivedAt?: string | null;
  /** Hub DB `shopify_orders.office_pending_at` (ISO); null = not on hold. */
  officePendingAt?: string | null;
  /** Shopify Order GID for Admin order edits. */
  shopifyOrderGid: string;
  /** ISO currency from synced order (e.g. CAD). */
  currencyCode: string | null;
  orderNumber: string;
  customerEmail: string | null;
  customerPhone: string | null;
  shippingAddressLine: string | null;
  /**
   * When `shippingAddress` JSON on the order has full fields — used for Separate PO
   * defaults and PO create `shippingAddress`.
   */
  defaultPoShippingAddress: PoAddress | null;
  customerDisplayName: string | null;
  orderedAt: string | null;
  note?: string;
  noteIsWarning?: boolean;
  lineItems: PrePoLineDraft[];
  /** True for internally-created replacement orders (missing/damaged items); not from Shopify. */
  isReplacementOrder?: boolean;
  /** Display-only Shopify order names this replacement order was created from. */
  referenceOrderNames?: string | null;
};
