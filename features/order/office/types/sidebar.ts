import type {
  SupplierEmailContact,
  SupplierOrderChannelType,
} from '@/lib/order/supplier-order-channel';
import type { SupplierDeliverySchedule } from '@/lib/order/supplier-delivery-schedule';

export type SupplierKey = string;

export type SupplierEntry = {
  meta: string;
  poCreated: boolean;
  referenceKey: string;
  dateCreated: string | null;
  expectedDate: string | null;
  supplierCompany: string;
  /** `order.supplier_groups.slug` when the supplier has a group; null if ungrouped or unassigned row. */
  supplierGroupSlug: string | null;
  /** One-line subtitle under supplier name in meta (email, link host, or “Direct”). */
  supplierOrderChannelSummary: string;
  supplierContactEmail: string;
  supplierEmailMissing: boolean;
  supplierOrderChannelType: SupplierOrderChannelType;
  /** Supplier PO / order email recipients (each row has its own display name). */
  supplierPoContacts: SupplierEmailContact[];
  /** Optional CC addresses merged into supplier outbound PO email sends. */
  supplierPoCcEmails: string[];
  supplierOrderUrl: string | null;
  supplierOrderInstruction: string;
  supplierInvoiceConfirmSenderEmail: string | null;
  fulfillDoneCount: number;
  fulfillPendingCount: number;
  fulfillTotalCount: number;
  hasEmail: boolean;
  hasChat: boolean;
  hasSms: boolean;
  emailSent: boolean;
  sidebarDates: string;
  /** Number of without-PO Shopify order drafts under this supplier (via vendor mapping). */
  withoutPoDraftCount: number;
  /** All linked Shopify orders are fulfilled. */
  allFulfilled: boolean;
  /** All fulfilled AND all POs have completedAt set (invoiced). */
  allCompleted: boolean;

  /** Latest Shopify order date (processedAt/shopifyCreatedAt) for Without PO filtering. */
  latestOrderedAt: string | null;
  /** All expected dates from POs (ISO date strings) for PO Created presets. */
  expectedDates: string[];
  /** Date when fulfilled (PO receivedAt or best proxy). */
  fulfilledAt: string | null;
  /** Date when completed (PO completedAt). */
  completedAt: string | null;
  /** Whether all POs (or all unlinked orders) for this entry are archived. */
  isArchived: boolean;
  /** IDs for `/api/order/archive`: PO ids when the row has POs; always includes unlinked Shopify order ids for that row. */
  archivePurchaseOrderIds: string[];
  archiveShopifyOrderIds: string[];
  /** Parsed default PO delivery schedule; null when unassigned or unset. */
  deliverySchedule: SupplierDeliverySchedule | null;
  /** Short code for default PO # after order number; if null, supplier `company` is used (not group). */
  officePoSupplierCode: string | null;
};

export type StatusTab =
  | 'inbox'
  | 'without_po'
  | 'po_pending'
  | 'po_created'
  | 'fulfilled'
  | 'completed'
  | 'archived';

export type PoPill = { label: string; id: string };

export type SidebarSupplierRow = {
  key: SupplierKey;
  name: string;
  poPills?: PoPill[];
  /** Count of without-PO draft orders under this supplier row. */
  withoutPoCount?: number;
};

export type CustomerAddress = {
  address1: string;
  address2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
};

/**
 * Inbox-style sidebar when grouped **supplier → customer**: supplier headline row,
 * nested rows reuse {@link SidebarSupplierRow} (key = `custId::supplierId` entry key,
 * name = customer headline).
 */
export type SidebarSupplierGroup = {
  /** DB supplier id (`custKey::supId` pair) or sentinel for unassigned. */
  id: string;
  name: string;
  officePoSupplierCode: string | null;
  customers: SidebarSupplierRow[];
  hasWithoutPo: boolean;
};

export type SidebarCustomerGroup = {
  id: string;
  /** Primary label: displayNameOverride → company → Shopify displayName → email. */
  name: string;
  email: string;
  /** Company name from Shopify customer (null if none). */
  company: string | null;
  /** Trimmed Shopify `displayName` (not override). Shown in subtitle when the headline is company. */
  customerDisplayName: string | null;
  /** Trimmed display name override when set. */
  displayNameOverride: string | null;
  suppliers: SidebarSupplierRow[];
  /** Whether any supplier in this group has without-PO drafts. */
  hasWithoutPo: boolean;
  /** ISO date string of the most recent order across all suppliers (for sorting). */
  latestOrderDate: string | null;
  /** Default shipping address from customer settings. */
  defaultShippingAddress: CustomerAddress | null;
  /** Default billing address from customer settings. */
  defaultBillingAddress: CustomerAddress | null;
  /** Whether billing address is same as shipping (customer default). */
  billingSameAsShipping: boolean;
  /** Short customer account code for default PO # (Office → Customer Settings). */
  officePoAccountCode: string | null;
};
