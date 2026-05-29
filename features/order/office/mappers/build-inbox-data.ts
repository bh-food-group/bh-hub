/**
 * Server-side aggregation: Prisma query results → full props for OrderManagementView.
 *
 * Groups POs by **ShopifyCustomer** (DB-based, not runtime API), builds sidebar
 * structure + per-supplier view data, and computes status tab counts.
 *
 * Without-PO orders are grouped by **line-item** vendor → supplier (via
 * `ShopifyVendorMapping`). A single Shopify order may appear under multiple
 * supplier rows (one slice per supplier), each showing only that supplier's lines
 * that are not yet on an **active** PO (`purchase_order_line_items` →
 * `shopify_order_line_item_id`).
 *
 * All data comes from the DB — no live Shopify API calls needed.
 */

import { mapPrismaPoToBlock, mapPrismaPoToSlimBlock } from './map-purchase-order';
import type { PrismaPoWithRelations, PrismaPoSlimWithRelations } from './map-purchase-order';
import {
  type CustomerIdentity,
  identityFromCustomerRow,
  identityFromEmail,
  mergeCustomerIdentities,
} from './customer-identity';
import {
  UNASSIGNED_SUPPLIER_ID,
  type VendorMapping,
  buildVendorLookup,
  supplierIdForLineItem,
} from './vendor-supplier-map';
import {
  buildLegacyExtraQtyByShopifyLineItemId,
  shopifyLineRemainingQty,
} from './legacy-po-allocation';

type AnyPo = PrismaPoSlimWithRelations | PrismaPoWithRelations;

function isSlimPo(po: AnyPo): po is PrismaPoSlimWithRelations {
  return '_count' in po;
}

import type {
  SupplierKey,
  SupplierEntry,
  ViewData,
  PostViewData,
  SidebarCustomerGroup,
  SidebarSupplierRow,
  PoPill,
  StatusTab,
  ShopifyOrderDraft,
  PurchaseOrderStatus,
} from '../types';
import type { Prisma } from '@prisma/client';
import { sortPrePoLineDraftsByProductTitleAsc } from '../utils/sort-lines-by-product-title';
import {
  legacyFallbackOrderChannel,
  type SupplierOrderChannelType,
  type EmailOrderChannelPayload,
  type OrderLinkChannelPayload,
  type DirectInstructionChannelPayload,
} from '@/lib/order/supplier-order-channel';
import { formatOfficeDateFromDate } from '../utils/format-date-label';
import { toVancouverYmd } from '../utils/vancouver-datetime';
import {
  isOfficePoDeliveryDone,
  supplierRowHasFulfilledListPo,
  supplierRowHasOpenDeliveryPo,
} from '../utils/po-fulfillment-for-tab';
import { computeEmailDeliveryOutstanding } from '../utils/po-email-delivery-policy';
import { parseSupplierDeliverySchedule } from '@/lib/order/supplier-delivery-schedule';
import { orderShippingJsonToPoAddress } from '../utils/order-shipping-json-to-po-address';
import type { LegacyOrphanPoLineForInbox } from '@/lib/order/fetch-legacy-orphan-po-lines-for-inbox';

export type { VendorMapping };

export type ShopifyOrderWithCustomer = Prisma.ShopifyOrderGetPayload<{
  include: {
    customer: true;
    purchaseOrders: { select: { archivedAt: true } };
    lineItems: {
      include: {
        purchaseOrderLineItems: { select: { id: true; quantity: true } };
      };
    };
  };
}>;

// ─── Output: full props for OrderManagementView ───────────────────────────────

export type InboxData = {
  initialStates: Record<SupplierKey, SupplierEntry>;
  viewDataMap: Record<SupplierKey, ViewData>;
  customerGroups: SidebarCustomerGroup[];
  supplierGroupFilterOptions: { slug: string; name: string }[];
  statusTabCounts: Record<StatusTab, number>;
  defaultActiveKey: SupplierKey | null;
};

// ─── DB payload types ─────────────────────────────────────────────────────────

type PrismaSupplierGroup = Prisma.SupplierGroupGetPayload<{
  include: { suppliers: true };
}>;

type SupplierScalar = PrismaSupplierGroup['suppliers'][0];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateShort(d: Date | null | undefined): string | null {
  if (!d) return null;
  const s = formatOfficeDateFromDate(d);
  return s || null;
}

function isoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  try { return d.toISOString().slice(0, 10); } catch { return null; }
}

function buildSidebarDates(pos: AnyPo[]): string {
  if (pos.length === 0) return 'Without PO';

  const created = pos.map((p) => p.dateCreated).filter((d): d is Date => d != null).sort((a, b) => a.getTime() - b.getTime());
  const expected = pos.map((p) => p.expectedDate).filter((d): d is Date => d != null).sort((a, b) => a.getTime() - b.getTime());

  const parts: string[] = [];
  if (created.length === 1) {
    parts.push(`Created ${fmtDateShort(created[0])}`);
  } else if (created.length > 1) {
    const first = fmtDateShort(created[0]);
    const last = fmtDateShort(created[created.length - 1]);
    parts.push(first === last ? `Created ${first}` : `Created ${first}–${last}`);
  }
  if (expected.length === 1) {
    parts.push(`Expected ${fmtDateShort(expected[0])}`);
  } else if (expected.length > 1) {
    const first = fmtDateShort(expected[0]);
    const last = fmtDateShort(expected[expected.length - 1]);
    parts.push(first === last ? `Expected ${first}` : `Expected ${first}–${last}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'PO created';
}

type ShippingJson = { address1?: string | null; city?: string | null; province?: string | null };

function flattenShippingAddress(json: unknown): string | null {
  if (json == null || typeof json !== 'object') return null;
  const s = json as ShippingJson;
  const parts = [s.address1, s.city, s.province].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

// ─── Customer identity helpers (re-exported from customer-identity.ts) ────────

function getPoCustomerIdentity(po: AnyPo): CustomerIdentity | null {
  for (const so of po.shopifyOrders) {
    if (so.customer) return identityFromCustomerRow(so.customer);
  }
  for (const so of po.shopifyOrders) {
    if (so.email) return identityFromEmail(so.email);
  }
  return null;
}

function getShopifyOrderCustomerIdentity(order: ShopifyOrderWithCustomer): CustomerIdentity | null {
  if (order.customer) return identityFromCustomerRow(order.customer);
  if (order.email) return identityFromEmail(order.email);
  return null;
}

// ─── Supplier channel fields ──────────────────────────────────────────────────

function buildChannelEntryFields(supplier: SupplierScalar | undefined): Pick<
  SupplierEntry,
  | 'supplierOrderChannelSummary' | 'supplierContactEmail' | 'supplierEmailMissing'
  | 'supplierOrderChannelType' | 'supplierPoContacts' | 'supplierPoCcEmails'
  | 'supplierOrderUrl' | 'supplierOrderInstruction' | 'supplierInvoiceConfirmSenderEmail'
  | 'hasEmail' | 'hasChat' | 'hasSms'
> {
  if (!supplier) {
    return {
      supplierOrderChannelSummary: '—', supplierContactEmail: 'no email on file',
      supplierEmailMissing: true, supplierOrderChannelType: 'direct_instruction',
      supplierPoContacts: [], supplierPoCcEmails: [], supplierOrderUrl: null,
      supplierOrderInstruction: '', supplierInvoiceConfirmSenderEmail: null,
      hasEmail: false, hasChat: false, hasSms: false,
    };
  }

  const ch = legacyFallbackOrderChannel({
    orderChannelType: supplier.orderChannelType,
    orderChannelPayload: supplier.orderChannelPayload,
    contactEmails: supplier.contactEmails,
    contactName: supplier.contactName,
    link: supplier.link,
    notes: supplier.notes,
  });

  if (ch.type === 'email') {
    const p = ch.payload as EmailOrderChannelPayload;
    const contacts = p.contacts;
    const emails = contacts.map((c) => c.email);
    const emailLine = emails.join(', ');
    const hasEmail = contacts.length > 0;
    const ccPart = (p.ccEmails ?? []).length > 0 ? ` · CC: ${(p.ccEmails ?? []).join(', ')}` : '';
    const summary = hasEmail
      ? contacts.map((c) => [c.name?.trim(), c.email].filter(Boolean).join(' · ')).join('; ') + ccPart
      : 'Email (not set)';
    return {
      supplierOrderChannelSummary: summary, supplierContactEmail: emailLine || 'no email on file',
      supplierEmailMissing: !hasEmail, supplierOrderChannelType: ch.type as SupplierOrderChannelType,
      supplierPoContacts: contacts, supplierPoCcEmails: p.ccEmails ?? [], supplierOrderUrl: null,
      supplierOrderInstruction: p.instruction ?? '', supplierInvoiceConfirmSenderEmail: null,
      hasEmail, hasChat: false, hasSms: false,
    };
  }

  if (ch.type === 'order_link') {
    const p = ch.payload as OrderLinkChannelPayload;
    let summary = 'Order link';
    try { if (p.orderUrl) summary = new URL(p.orderUrl).hostname; } catch { /* ignore */ }
    return {
      supplierOrderChannelSummary: summary, supplierContactEmail: p.orderUrl?.trim() || '—',
      supplierEmailMissing: false, supplierOrderChannelType: ch.type as SupplierOrderChannelType,
      supplierPoContacts: [], supplierPoCcEmails: [], supplierOrderUrl: p.orderUrl?.trim() ?? null,
      supplierOrderInstruction: p.instruction ?? '', supplierInvoiceConfirmSenderEmail: p.invoiceConfirmSenderEmail ?? null,
      hasEmail: false, hasChat: false, hasSms: false,
    };
  }

  const p = ch.payload as DirectInstructionChannelPayload;
  const instr = p.instruction ?? '';
  return {
    supplierOrderChannelSummary: 'Direct instructions',
    supplierContactEmail: instr ? (instr.length > 56 ? `${instr.slice(0, 56)}…` : instr) : '—',
    supplierEmailMissing: false, supplierOrderChannelType: ch.type as SupplierOrderChannelType,
    supplierPoContacts: [], supplierPoCcEmails: [], supplierOrderUrl: null,
    supplierOrderInstruction: instr, supplierInvoiceConfirmSenderEmail: null,
    hasEmail: false, hasChat: false, hasSms: false,
  };
}

// ─── Supplier bucket helpers ──────────────────────────────────────────────────

function distinctSupplierIdsForOrder(
  order: ShopifyOrderWithCustomer,
  lookups: ReturnType<typeof buildVendorLookup>,
  legacyExtraQtyByShopifyLineItemId: Map<string, number>,
): string[] {
  if (order.lineItems.length === 0) {
    const pos = order.purchaseOrders ?? [];
    if (pos.length > 0 && pos.every((p) => p.archivedAt != null)) return [];
    return [UNASSIGNED_SUPPLIER_ID];
  }
  const set = new Set<string>();
  for (const li of order.lineItems) {
    if ((li.quantity ?? 0) <= 0) continue;
    if (shopifyLineRemainingQty(li, legacyExtraQtyByShopifyLineItemId) <= 0) continue;
    set.add(supplierIdForLineItem(li, lookups));
  }
  return [...set];
}

// ─── Shopify order → draft mapping ───────────────────────────────────────────

function shopifyOrderToDraft(
  order: ShopifyOrderWithCustomer,
  supplierBucketId: string,
  lookups: ReturnType<typeof buildVendorLookup>,
  variantDefaultLineNotes: ReadonlyMap<string, string>,
  legacyExtraQtyByShopifyLineItemId: Map<string, number>,
): ShopifyOrderDraft {
  const customer = order.customer;
  const orderEmail = order.email ?? customer?.email ?? null;
  const primaryLabel = customer
    ? (() => {
        const name = [customer.displayNameOverride?.trim(), customer.displayName?.trim()].find(Boolean) ?? null;
        if (name && name !== 'Unknown') return name;
        return orderEmail?.trim() ?? null;
      })()
    : orderEmail?.trim() ?? null;

  const rawLines = order.isReplacementOrder
    ? order.lineItems
    : supplierBucketId === UNASSIGNED_SUPPLIER_ID
      ? order.lineItems.filter(
          (li) =>
            shopifyLineRemainingQty(li, legacyExtraQtyByShopifyLineItemId) > 0 &&
            supplierIdForLineItem(li, lookups) === UNASSIGNED_SUPPLIER_ID,
        )
      : order.lineItems.filter(
          (li) =>
            shopifyLineRemainingQty(li, legacyExtraQtyByShopifyLineItemId) > 0 &&
            supplierIdForLineItem(li, lookups) === supplierBucketId,
        );

  const rawNote = order.customerNote?.trim();
  return {
    id: order.id,
    archivedAt: order.archivedAt ? order.archivedAt.toISOString() : null,
    officePendingAt: order.officePendingAt ? order.officePendingAt.toISOString() : null,
    shopifyOrderGid: order.shopifyGid,
    currencyCode: order.currencyCode ?? null,
    orderNumber: order.name ?? order.id,
    isReplacementOrder: order.isReplacementOrder ?? false,
    referenceOrderNames: order.referenceOrderNames ?? null,
    customerEmail: customer?.email ?? order.email ?? null,
    customerPhone: customer?.phone ?? null,
    shippingAddressLine: flattenShippingAddress(order.shippingAddress),
    defaultPoShippingAddress: orderShippingJsonToPoAddress(order.shippingAddress),
    customerDisplayName: primaryLabel,
    ...(rawNote ? { note: rawNote } : {}),
    orderedAt: order.processedAt?.toISOString() ?? order.shopifyCreatedAt?.toISOString() ?? null,
    lineItems: sortPrePoLineDraftsByProductTitleAsc(
      rawLines.map((li) => {
        const vg = li.variantGid?.trim() ?? null;
        const defaultPoLineNote = vg ? variantDefaultLineNotes.get(vg) ?? null : null;
        const shopifySourceLineQty = li.quantity ?? 0;
        return {
          shopifyLineItemId: li.id,
          shopifyLineItemGid: li.shopifyGid,
          shopifyProductGid: li.productGid?.trim() || null,
          shopifyVariantGid: li.variantGid,
          sku: li.sku,
          imageUrl: li.imageUrl ?? null,
          productTitle: li.title ?? '(untitled)',
          variantTitle: li.variantTitle ?? null,
          itemPrice: li.price ? String(li.price) : null,
          itemCost: li.unitCost ? String(li.unitCost) : null,
          shopifySourceLineQty,
          quantity: order.isReplacementOrder
            ? shopifySourceLineQty
            : shopifyLineRemainingQty(li, legacyExtraQtyByShopifyLineItemId),
          includeInPo: true,
          defaultPoLineNote,
        };
      }),
    ),
  };
}

// ─── Main builder ─────────────────────────────────────────────────────────────

const UNKNOWN_CUSTOMER_KEY = '__unknown_customer__';

export function buildInboxData(
  activePurchaseOrders: PrismaPoSlimWithRelations[],
  archivedPurchaseOrders: PrismaPoWithRelations[],
  supplierGroups: PrismaSupplierGroup[],
  unlinkedShopifyOrders: ShopifyOrderWithCustomer[],
  vendorMappings: VendorMapping[],
  lineCountsByPoId: Map<string, { total: number; done: number }>,
  variantDefaultLineNotes: ReadonlyMap<string, string> = new Map(),
  legacyOrphanPoLines: LegacyOrphanPoLineForInbox[] = [],
  replacementOrderCountByPoId: Map<string, number> = new Map(),
): InboxData {
  const purchaseOrders: AnyPo[] = [...activePurchaseOrders, ...archivedPurchaseOrders];
  const initialStates: Record<SupplierKey, SupplierEntry> = {};
  const viewDataMap: Record<SupplierKey, ViewData> = {};

  const groupSlugById = new Map<string, string>();
  for (const g of supplierGroups) groupSlugById.set(g.id, g.slug);
  const supplierGroupFilterOptions = supplierGroups.map((g) => ({ slug: g.slug, name: g.name }));

  type SupplierMeta = PrismaSupplierGroup['suppliers'][0];
  const supplierById = new Map<string, SupplierMeta>();
  for (const g of supplierGroups) {
    for (const s of g.suppliers) supplierById.set(s.id, s);
  }
  for (const po of purchaseOrders) {
    if (po.supplierId && po.supplier && !supplierById.has(po.supplierId)) {
      supplierById.set(po.supplierId, po.supplier);
    }
  }

  const lookups = buildVendorLookup(vendorMappings);
  const legacyExtraQtyByShopifyLineItemId = buildLegacyExtraQtyByShopifyLineItemId(
    unlinkedShopifyOrders,
    legacyOrphanPoLines,
  );

  // ── Group POs by customer → supplier ──

  const byCustSup = new Map<string, Map<string, AnyPo[]>>();
  const custInfoMap = new Map<string, CustomerIdentity>();

  for (const po of purchaseOrders) {
    const identity = getPoCustomerIdentity(po);
    const custKey = identity?.customerId ?? UNKNOWN_CUSTOMER_KEY;
    if (identity) {
      const prev = custInfoMap.get(custKey);
      custInfoMap.set(custKey, prev ? mergeCustomerIdentities(prev, identity) : identity);
    }
    const supKey = po.supplierId ?? UNASSIGNED_SUPPLIER_ID;
    if (!byCustSup.has(custKey)) byCustSup.set(custKey, new Map());
    const supMap = byCustSup.get(custKey)!;
    if (!supMap.has(supKey)) supMap.set(supKey, []);
    supMap.get(supKey)!.push(po);
  }

  // ── Group unlinked orders by customer → resolved supplier ──

  const unlinkedByCustSup = new Map<string, Map<string, ShopifyOrderWithCustomer[]>>();

  for (const o of unlinkedShopifyOrders) {
    const identity = getShopifyOrderCustomerIdentity(o);
    const custKey = identity?.customerId ?? UNKNOWN_CUSTOMER_KEY;
    if (identity) {
      const prev = custInfoMap.get(custKey);
      custInfoMap.set(custKey, prev ? mergeCustomerIdentities(prev, identity) : identity);
    }
    const supIds = distinctSupplierIdsForOrder(o, lookups, legacyExtraQtyByShopifyLineItemId);
    if (!unlinkedByCustSup.has(custKey)) unlinkedByCustSup.set(custKey, new Map());
    const supMap = unlinkedByCustSup.get(custKey)!;
    for (const supId of supIds) {
      if (!supMap.has(supId)) supMap.set(supId, []);
      supMap.get(supId)!.push(o);
    }
  }

  // ── Collect all customer × supplier pairs ──

  const allCustKeys = new Set([...byCustSup.keys(), ...unlinkedByCustSup.keys()]);

  const statusCounts: Record<StatusTab, number> = {
    inbox: 0, without_po: 0, po_pending: 0, po_created: 0, fulfilled: 0, completed: 0, archived: 0,
  };

  const customerGroups: SidebarCustomerGroup[] = [];
  const supLatestOrderDate = new Map<SupplierKey, string | null>();

  for (const custKey of allCustKeys) {
    const custInfo = custInfoMap.get(custKey);
    const poSupMap = byCustSup.get(custKey) ?? new Map<string, PrismaPoWithRelations[]>();
    const draftSupMap = unlinkedByCustSup.get(custKey) ?? new Map<string, ShopifyOrderWithCustomer[]>();

    const allSupIds = new Set([...poSupMap.keys(), ...draftSupMap.keys()]);
    const supplierRows: SidebarSupplierRow[] = [];

    for (const supId of allSupIds) {
      const pos = poSupMap.get(supId) ?? [];
      const draftOrders = draftSupMap.get(supId) ?? [];
      const openDraftOrders = draftOrders.filter((o) => o.archivedAt == null);
      const hasPOs = pos.length > 0;
      const hasOpenDrafts = openDraftOrders.length > 0;
      if (!hasPOs && draftOrders.length === 0) continue;

      const supplier = supId !== UNASSIGNED_SUPPLIER_ID ? supplierById.get(supId) : undefined;
      const supplierName = supId === UNASSIGNED_SUPPLIER_ID ? 'Unassigned' : (supplier?.company ?? 'Unknown Supplier');
      const supplierGroupSlug = supId === UNASSIGNED_SUPPLIER_ID || !supplier?.groupId
        ? null
        : (groupSlugById.get(supplier.groupId) ?? null);
      const entryKey: SupplierKey = `${custKey}::${supId}`;

      const drafts = openDraftOrders.map((o) =>
        shopifyOrderToDraft(o, supId, lookups, variantDefaultLineNotes, legacyExtraQtyByShopifyLineItemId),
      );

      const poBlocks = hasPOs
        ? pos.map((p) =>
            isSlimPo(p)
              ? mapPrismaPoToSlimBlock(p, lineCountsByPoId.get(p.id) ?? { total: 0, done: 0 }, replacementOrderCountByPoId.get(p.id) ?? 0)
              : mapPrismaPoToBlock(p, undefined, replacementOrderCountByPoId.get(p.id) ?? 0),
          )
        : [];

      let fulfillDone = 0;
      let fulfillTotal = 0;
      for (const b of poBlocks) {
        const m = b.panelMeta;
        if (m) { fulfillDone += m.fulfillDoneCount; fulfillTotal += m.fulfillTotalCount; }
      }
      const fulfillPending = fulfillTotal - fulfillDone;

      const allFulfilled = poBlocks.length > 0 && poBlocks.every((b) => isOfficePoDeliveryDone(b));
      const allPosCompleted = allFulfilled && pos.length > 0 && pos.every((p) => p.completedAt != null);

      const viewSlice: PostViewData = {
        type: 'post',
        purchaseOrders: poBlocks,
        ...(hasOpenDrafts ? { shopifyOrderDrafts: drafts } : {}),
      };
      const rowHasOpenPo = supplierRowHasOpenDeliveryPo(viewSlice);
      const rowHasFulfilledListPo = supplierRowHasFulfilledListPo(viewSlice);

      const allPosArchived = !hasPOs || pos.every((p) => p.archivedAt != null);
      const allDraftsArchived = draftOrders.length === 0 || draftOrders.every((o) => o.archivedAt != null);
      const isArchived = allPosArchived && allDraftsArchived;

      const archivePurchaseOrderIds = hasPOs ? pos.map((p) => p.id) : [];
      const archiveShopifyOrderIds = draftOrders.map((o) => o.id);

      if (isArchived) {
        statusCounts.archived++;
      } else {
        if (hasPOs) {
          if (allPosCompleted) {
            statusCounts.completed++;
          } else {
            if (rowHasOpenPo) { statusCounts.po_created++; statusCounts.inbox++; }
            if (rowHasFulfilledListPo) statusCounts.fulfilled++;
          }
        }
        if (hasOpenDrafts) {
          statusCounts.without_po++;
          if (!hasPOs) statusCounts.inbox++;
        }
      }

      const channelFields = buildChannelEntryFields(supplier);
      const anyEmailDeliveryOutstanding = hasPOs && pos.some((p) =>
        computeEmailDeliveryOutstanding({
          supplierOrderChannelType: channelFields.supplierOrderChannelType,
          emailSentAt: p.emailSentAt,
          archivedAt: p.archivedAt,
          legacyExternalId: p.legacyExternalId,
          emailDeliveryWaivedAt: p.emailDeliveryWaivedAt,
          purchaseOrderStatus: p.status as PurchaseOrderStatus,
        }),
      );

      const custLabel = custInfo?.name ?? 'Unknown';
      const poCount = pos.length;
      const metaParts = [custLabel, supplierName];
      if (poCount > 0) metaParts.push(`${poCount} PO${poCount !== 1 ? 's' : ''}`);
      if (openDraftOrders.length > 0) metaParts.push(`${openDraftOrders.length} order${openDraftOrders.length !== 1 ? 's' : ''} without PO`);

      const dates = pos.map((p) => p.dateCreated).filter((d): d is Date => d != null);
      const earliestDate = dates.length > 0 ? dates.sort((a, b) => a.getTime() - b.getTime())[0] : null;
      const expectedDates = pos.map((p) => p.expectedDate).filter((d): d is Date => d != null);
      const latestExpected = expectedDates.length > 0 ? expectedDates.sort((a, b) => b.getTime() - a.getTime())[0] : null;
      const sidebarDates = hasPOs
        ? buildSidebarDates(pos)
        : `${openDraftOrders.length} order${openDraftOrders.length !== 1 ? 's' : ''} without PO`;

      let latestOrdered: Date | null = null;
      for (const po of pos) {
        for (const so of po.shopifyOrders) {
          const d = so.processedAt ?? so.shopifyCreatedAt;
          if (d && (!latestOrdered || d > latestOrdered)) latestOrdered = d;
        }
      }
      for (const o of draftOrders) {
        const d = o.processedAt ?? o.shopifyCreatedAt;
        if (d && (!latestOrdered || d > latestOrdered)) latestOrdered = d;
      }

      const allExpectedDates = pos.map((p) => isoDate(p.expectedDate)).filter((d): d is string => d != null);
      const uniqueExpectedDates = [...new Set(allExpectedDates)].sort();

      let fulfilledDate: Date | null = null;
      for (const po of pos) {
        if (po.receivedAt && (!fulfilledDate || po.receivedAt > fulfilledDate)) fulfilledDate = po.receivedAt;
      }
      if (!fulfilledDate) {
        for (const po of pos) {
          for (const so of po.shopifyOrders) {
            if (so.displayFulfillmentStatus === 'FULFILLED' && so.updatedAt) {
              if (!fulfilledDate || so.updatedAt > fulfilledDate) fulfilledDate = so.updatedAt;
            }
          }
        }
      }

      let completedDate: Date | null = null;
      for (const po of pos) {
        if (po.completedAt && (!completedDate || po.completedAt > completedDate)) completedDate = po.completedAt;
      }

      initialStates[entryKey] = {
        meta: metaParts.join(' · '),
        poCreated: hasPOs,
        referenceKey: hasPOs ? pos.map((p) => p.poNumber).join('+') : `${custLabel}–without-po–${supplierName}`,
        dateCreated: isoDate(earliestDate),
        expectedDate: isoDate(latestExpected),
        supplierCompany: supplierName,
        supplierGroupSlug,
        officePoSupplierCode: supId === UNASSIGNED_SUPPLIER_ID || !supplier ? null : supplier.officePoSupplierCode?.trim() || null,
        ...channelFields,
        fulfillDoneCount: fulfillDone,
        fulfillPendingCount: fulfillPending,
        fulfillTotalCount: fulfillTotal,
        emailSent: channelFields.supplierOrderChannelType === 'email' && hasPOs ? !anyEmailDeliveryOutstanding : false,
        sidebarDates,
        withoutPoDraftCount: openDraftOrders.length,
        allFulfilled,
        allCompleted: allPosCompleted,
        latestOrderedAt: latestOrdered ? toVancouverYmd(latestOrdered) : null,
        expectedDates: uniqueExpectedDates,
        fulfilledAt: fulfilledDate ? fulfilledDate.toISOString().slice(0, 10) : null,
        completedAt: completedDate ? completedDate.toISOString().slice(0, 10) : null,
        isArchived,
        archivePurchaseOrderIds,
        archiveShopifyOrderIds,
        deliverySchedule: supplier != null ? parseSupplierDeliverySchedule(supplier.deliverySchedule) ?? null : null,
      };

      if (hasPOs) {
        const blocks = poBlocks;
        const isMulti = blocks.length > 1;
        if (isMulti) {
          for (const block of blocks) {
            block.subtreeRowLabel = `PO #${block.poNumber}${block.isAuto ? '' : ' — custom'}`;
          }
        }
        viewDataMap[entryKey] = {
          type: 'post',
          purchaseOrders: blocks,
          shopifyOrderDrafts: hasOpenDrafts ? drafts : undefined,
          ...(isMulti && { subtreeParentLabel: `${supplierName} · ${blocks.length} POs`, multiPoSubtree: true }),
        } satisfies PostViewData;
      } else {
        viewDataMap[entryKey] = { type: 'pre', shopifyOrderDrafts: drafts };
      }

      const poPills: PoPill[] | undefined = pos.length > 1 ? pos.map((p) => ({ label: `PO #${p.poNumber}`, id: p.id })) : undefined;

      supplierRows.push({
        key: entryKey,
        name: supplierName,
        poPills,
        withoutPoCount: openDraftOrders.length > 0 ? openDraftOrders.length : undefined,
      });

      let supLatest: Date | null = null;
      for (const po of pos) {
        for (const so of po.shopifyOrders) {
          const d = so.processedAt ?? so.shopifyCreatedAt;
          if (d && (!supLatest || d > supLatest)) supLatest = d;
        }
      }
      for (const o of draftOrders) {
        const d = o.processedAt ?? o.shopifyCreatedAt;
        if (d && (!supLatest || d > supLatest)) supLatest = d;
      }
      supLatestOrderDate.set(entryKey, supLatest ? supLatest.toISOString() : null);
    }

    function officePoAccountCodeForCustomer(): string | null {
      const fromMap = custInfo?.officePoAccountCode?.trim();
      if (fromMap) return fromMap;
      for (const pos of poSupMap.values()) {
        for (const po of pos) {
          for (const so of po.shopifyOrders) {
            const c = so.customer?.officePoAccountCode?.trim();
            if (c) return c;
          }
        }
      }
      for (const orders of draftSupMap.values()) {
        for (const o of orders) {
          const c = o.customer?.officePoAccountCode?.trim();
          if (c) return c;
        }
      }
      return null;
    }

    if (supplierRows.length > 0) {
      supplierRows.sort((a, b) => {
        const da = supLatestOrderDate.get(a.key) ?? '';
        const db = supLatestOrderDate.get(b.key) ?? '';
        if (da > db) return -1;
        if (da < db) return 1;
        return 0;
      });

      const hasWithoutPo = supplierRows.some((r) => (r.withoutPoCount ?? 0) > 0);

      const poGroup = byCustSup.get(custKey);
      const draftGroup = unlinkedByCustSup.get(custKey);
      let latestDate: Date | null = null;
      if (poGroup) {
        for (const pos of poGroup.values()) {
          for (const po of pos) {
            for (const so of po.shopifyOrders) {
              const d = so.processedAt ?? so.shopifyCreatedAt;
              if (d && (!latestDate || d > latestDate)) latestDate = d;
            }
          }
        }
      }
      if (draftGroup) {
        for (const orders of draftGroup.values()) {
          for (const o of orders) {
            const d = o.processedAt ?? o.shopifyCreatedAt;
            if (d && (!latestDate || d > latestDate)) latestDate = d;
          }
        }
      }

      customerGroups.push({
        id: custKey,
        name: custInfo?.name ?? '—',
        email: custInfo?.email ?? '',
        company: custInfo?.company ?? null,
        customerDisplayName: custInfo?.customerDisplayName ?? null,
        displayNameOverride: custInfo?.displayNameOverride ?? null,
        officePoAccountCode: officePoAccountCodeForCustomer(),
        suppliers: supplierRows,
        hasWithoutPo,
        latestOrderDate: latestDate ? latestDate.toISOString() : null,
        defaultShippingAddress: custInfo?.defaultShippingAddress ?? null,
        defaultBillingAddress: custInfo?.defaultBillingAddress ?? null,
        billingSameAsShipping: custInfo?.billingSameAsShipping ?? true,
      });
    }
  }

  customerGroups.sort((a, b) => {
    const aUnknown = a.id === UNKNOWN_CUSTOMER_KEY;
    const bUnknown = b.id === UNKNOWN_CUSTOMER_KEY;
    if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
    const da = a.latestOrderDate ?? '';
    const db = b.latestOrderDate ?? '';
    if (da > db) return -1;
    if (da < db) return 1;
    return 0;
  });

  const allKeys = Object.keys(initialStates);
  const defaultActiveKey = allKeys[0] ?? null;

  console.log(
    `[buildInboxData] ${purchaseOrders.length} POs, ${unlinkedShopifyOrders.length} unlinked orders → ${customerGroups.length} customer groups, ${allKeys.length} entries`,
    statusCounts,
  );

  return { initialStates, viewDataMap, customerGroups, supplierGroupFilterOptions, statusTabCounts: statusCounts, defaultActiveKey };
}
