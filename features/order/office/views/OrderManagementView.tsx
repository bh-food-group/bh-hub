'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { StatusTabBar } from '../components/StatusTabBar';
import { PeriodFilterBar } from '../components/PeriodFilterBar';
import { Sidebar } from '../components/Sidebar';
import { CenterBar } from '../components/CenterBar';
import { PrePoView } from '../components/PrePoView';
import { PostPoView } from '../components/PostPoView';
import { MetaPanel } from '../components/MetaPanel';
import { OrderProcessingBlock } from '../components/OrderProcessingBlock';
import { PoEmailDeliveryAlertsStrip } from '../components/PoEmailDeliveryAlertsStrip';
import { OfficePendingOrdersAlertsStrip } from '../components/OfficePendingOrdersAlertsStrip';
import {
  collectPoEmailDeliveryAlerts,
  pickStatusTabForEmailAlertPo,
  type PoEmailDeliveryAlertItem,
} from '../utils/collect-po-email-delivery-alerts';
import {
  collectOfficePendingOrderAlerts,
  type OfficePendingOrderAlertItem,
} from '../utils/collect-office-pending-order-alerts';
import { useRouter } from 'next/navigation';
import { formatOfficeDateChip } from '../utils/format-date-label';
import {
  formatVancouverYmdChip,
  toVancouverYmd,
  toVancouverYmdFromIso,
} from '../utils/vancouver-datetime';
import { computeDefaultExpectedYmd } from '@/lib/order/supplier-delivery-default-date';
import {
  formatOfficeDefaultPoNumber,
  officeInboxCustomerPoSegment,
  officeInboxSupplierPoSegment,
} from '../utils/format-office-default-po-number';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  OfficeTableSplitView,
  type OfficeTableFilterOption,
} from '../components/OfficeTableSplitView';
import { findSupplierKeyForPurchaseOrderId } from '../utils/find-supplier-key-for-po';
import type {
  OfficeTableViewPoRow,
  OfficeTableViewShopifyRow,
} from '../types/office-table-view';
import type {
  SupplierKey,
  SupplierEntry,
  StatusTab,
  PeriodKey,
  PostViewData,
  PoPanelMeta,
  ViewData,
  OfficePurchaseOrderBlock,
  PoLineItemView,
  SidebarCustomerGroup,
  Period,
  ShopifyOrderDraft,
  PurchaseOrderStatus,
} from '../types';
import type { CreatePoPayload, EditPoFields } from '../components/MetaPanel';
import type { SeparatePoPayload } from '../types';
import {
  buildExpectedDateBuckets,
  expectedDateKeyFromPo,
  findBucketPageIndex,
  pickFirstPoInNewestExpectedBucket,
} from '../utils/sidebar-by-expected-date';
import { buildSupplierFirstGroups } from '../utils/build-supplier-first-sidebar';
import {
  expectedDateKeysForPoPendingTab,
  expectedDateKeysForPoTab,
  isOfficePoDeliveryDone,
  supplierRowHasFulfilledListPo,
  supplierRowHasOpenDeliveryPo,
  supplierRowHasPendingPo,
} from '../utils/po-fulfillment-for-tab';
import {
  mergeViewDataWithOptimisticPoCreates,
  mergeViewDataWithOptimisticPoDeletes,
  patchSupplierEntryAfterPoCreate,
  patchSupplierEntryAfterPoDelete,
} from '../utils/merge-optimistic-po-create';
import { mergeViewDataWithOptimisticEmailSent } from '../utils/merge-view-data-optimistic-email-sent';
import { mergeViewDataWithOptimisticEmailWaived } from '../utils/merge-view-data-optimistic-email-waived';
import { mergeViewDataWithOptimisticPoHubStatus } from '../utils/merge-view-data-optimistic-po-hub-status';
import {
  mergeViewDataWithOptimisticPoPanelEdits,
  panelPatchFromEditPoFields,
  type OptimisticPoPanelEditPatch,
} from '../utils/merge-view-data-optimistic-po-panel-edit';
import { filterInboxDraftsForDisplay } from '../utils/filter-inbox-drafts-for-display';
import { buildPoPdfInput, openPoPdfPrint } from '../utils/purchase-order-pdf';
import { CreateShopifyOrderDialog } from '../components/CreateShopifyOrderDialog';

/**
 * PO Created tab: max expected-date preset chips beside “All” in the bar (4).
 * With “All” + “More…” the row shows at most 6 buttons; older dates go to More.
 */
const MAX_EXPECTED_DATE_CHIPS = 4;

/** When creating a PO from office drafts, default supplier ref from the line SKU. */
function supplierRefFromSku(sku: string | null | undefined): string | null {
  const t = sku?.trim();
  return t ? t : null;
}

/** Sidebar (non-Inbox): expected-date sections per “page” of dates. */
const EXPECTED_DATE_SIDEBAR_PAGE_SIZE = 5;

/**
 * Safety cap for lazy line-item fetch (slim `/line-items` API — not the full PO).
 * Prevents an indefinite spinner if the connection stalls; normal loads stay well under this.
 */
const LAZY_PO_LINE_ITEMS_FETCH_MS = 12_000;

/** Vancouver `YYYY-MM-DD` from each without-PO draft (period chips vs `latestOrderedAt`). */
function shopifyDraftOrderedDaysForKey(
  supplierKey: SupplierKey,
  viewDataMap: Record<string, ViewData>,
): Set<string> {
  const vd = viewDataMap[supplierKey];
  if (!vd) return new Set();
  const drafts =
    vd.type === 'pre' ? vd.shopifyOrderDrafts : (vd.shopifyOrderDrafts ?? []);
  const days = new Set<string>();
  for (const d of drafts) {
    if (d.archivedAt) continue;
    const day = d.orderedAt ? toVancouverYmdFromIso(d.orderedAt) : undefined;
    if (day) days.add(day);
  }
  return days;
}

/** Merge server `viewDataMap` with pending archive/unarchive so list + chips update before refresh. */
function mergeViewDataWithOptimisticDraftArchive(
  viewDataMap: Record<string, ViewData>,
  optimisticArchived: ReadonlySet<string>,
  optimisticUnarchived: ReadonlySet<string>,
): Record<string, ViewData> {
  if (optimisticArchived.size === 0 && optimisticUnarchived.size === 0) {
    return viewDataMap;
  }
  const stamp = new Date().toISOString();
  const patchDraft = (d: ShopifyOrderDraft): ShopifyOrderDraft => {
    const serverArchived = d.archivedAt ?? null;
    let archivedAt = serverArchived;
    if (optimisticUnarchived.has(d.id)) archivedAt = null;
    else if (optimisticArchived.has(d.id)) archivedAt = stamp;
    if (archivedAt === serverArchived) return d;
    return { ...d, archivedAt };
  };
  let anyChange = false;
  const out: Record<string, ViewData> = { ...viewDataMap };
  for (const key of Object.keys(viewDataMap)) {
    const vd = viewDataMap[key];
    const drafts =
      vd.type === 'pre' ? vd.shopifyOrderDrafts : (vd.shopifyOrderDrafts ?? []);
    if (!drafts.length) continue;
    const next = drafts.map(patchDraft);
    if (!next.some((d, i) => d !== drafts[i])) continue;
    anyChange = true;
    out[key] =
      vd.type === 'pre'
        ? { ...vd, shopifyOrderDrafts: next }
        : { ...vd, shopifyOrderDrafts: next };
  }
  return anyChange ? out : viewDataMap;
}

function mergeViewDataWithLazyLineItems(
  viewDataMap: Record<SupplierKey, ViewData>,
  lazyItems: Record<string, PoLineItemView[]>,
): Record<SupplierKey, ViewData> {
  if (Object.keys(lazyItems).length === 0) return viewDataMap;
  let any = false;
  const out: Record<SupplierKey, ViewData> = { ...viewDataMap };
  for (const [key, vd] of Object.entries(viewDataMap)) {
    if (vd.type !== 'post') continue;
    let changed = false;
    const nextPos = vd.purchaseOrders.map((po) => {
      const items = lazyItems[po.id];
      if (!items || po.lineItems.length > 0) return po;
      changed = true;
      return { ...po, lineItems: items };
    });
    if (!changed) continue;
    any = true;
    out[key] = { ...vd, purchaseOrders: nextPos };
  }
  return any ? out : viewDataMap;
}

export type OrderManagementViewProps = {
  /** When true, office can create Shopify orders and use Admin search APIs (`SHOPIFY_*` env). */
  shopifyAdminApiConfigured?: boolean;
  /** Parsed from `SHOPIFY_SHOP_DOMAIN` for Admin product links in Inbox / PO tables. */
  shopifyAdminStoreHandle?: string | null;
  initialStates: Record<SupplierKey, SupplierEntry>;
  viewDataMap: Record<SupplierKey, ViewData>;
  customerGroups: SidebarCustomerGroup[];
  supplierGroupFilterOptions: { slug: string; name: string }[];
  statusTabCounts: Record<StatusTab, number>;
  defaultActiveKey: string | null;
  periods: Period[];
  tableViewShopifyRows: OfficeTableViewShopifyRow[];
  tableViewPoRows: OfficeTableViewPoRow[];
  tableViewShopifyTotal: number;
  tableViewPoTotal: number;
};

export function OrderManagementView({
  shopifyAdminApiConfigured = false,
  shopifyAdminStoreHandle,
  initialStates,
  viewDataMap,
  customerGroups,
  supplierGroupFilterOptions,
  statusTabCounts: _statusTabCounts,
  defaultActiveKey,
  periods,
  tableViewShopifyRows,
  tableViewPoRows,
  tableViewShopifyTotal,
  tableViewPoTotal,
}: OrderManagementViewProps) {
  void _statusTabCounts;
  const [createShopifyOrderOpen, setCreateShopifyOrderOpen] = useState(false);
  const [mainPanel, setMainPanel] = useState<'grouped' | 'table'>('grouped');
  /** Table view: drill-in to same center/meta UI as Grouped view for one PO. */
  const [tablePoDetailPoId, setTablePoDetailPoId] = useState<string | null>(
    null,
  );
  const [states, setStates] =
    useState<Record<SupplierKey, SupplierEntry>>(initialStates);

  /** After `router.refresh()` (e.g. Shopify sync), RSC passes new props; keep local `states` in sync. */
  useEffect(() => {
    setStates(initialStates);
  }, [initialStates]);

  const router = useRouter();

  useEffect(() => {
    if (mainPanel !== 'table') setTablePoDetailPoId(null);
  }, [mainPanel]);

  const firstKey = defaultActiveKey ?? Object.keys(initialStates)[0] ?? null;

  const [activeKey, setActiveKey] = useState<SupplierKey>(firstKey ?? '');
  const [activeStatusTab, setActiveStatusTab] =
    useState<StatusTab>('without_po');
  const prevStatusTabRef = useRef<StatusTab | null>(null);
  const [activePeriod, setActivePeriod] = useState<PeriodKey>('all');
  const [selectedPoBlockId, setSelectedPoBlockId] = useState<string | null>(
    null,
  );
  const [showArchived, setShowArchived] = useState(false);

  /** PO Created tab: group sidebar by delivery expected date (default) or PO creation date. */
  const [poCreatedDateMode, setPoCreatedDateMode] = useState<
    'delivery_expected' | 'po_created'
  >('delivery_expected');
  /** Active supplier group filter by `supplier_groups.slug` (null = all). Reset on tab change. */
  const [activeSupplierGroupSlug, setActiveSupplierGroupSlug] = useState<
    string | null
  >(null);

  /**
   * Sidebar: customer → supplier (default) vs supplier → customer (Inbox + PO Created / Fulfilled buckets).
   */
  const [sidebarHierarchy, setSidebarHierarchy] = useState<
    'customer_first' | 'supplier_first'
  >('customer_first');

  // ── Draft inclusion state (lifted from OrderBlock checkboxes) ──
  const [draftInclusions, setDraftInclusions] = useState<
    Record<string, boolean[]>
  >({});
  /** Per Shopify order draft, per line: PO/PDF line note (starts from Item settings default). */
  const [draftLineNotes, setDraftLineNotes] = useState<
    Record<string, string[]>
  >({});
  const [draftPoNumber, setDraftPoNumber] = useState('');
  const [poNumberIsManual, setPoNumberIsManual] = useState(false);

  const [optimisticArchivedOrderIds, setOptimisticArchivedOrderIds] = useState(
    () => new Set<string>(),
  );
  const [optimisticUnarchivedOrderIds, setOptimisticUnarchivedOrderIds] =
    useState(() => new Set<string>());

  const [optimisticPoPatchesByKey, setOptimisticPoPatchesByKey] = useState<
    Partial<
      Record<
        SupplierKey,
        { newBlock: OfficePurchaseOrderBlock; removedDraftIds: string[] }
      >
    >
  >({});

  /** Alert row → tab switch: sidebar effect applies key + PO on next run (avoids Inbox forcing drafts). */
  const pendingPoNavigationRef = useRef<{
    supplierKey: SupplierKey;
    poId: string;
  } | null>(null);

  /**
   * After creating a PO from Inbox, `selectedPoBlockId` is forced to `__drafts__` while drafts remain.
   * When the user opens the “PO created” tab, pick this PO instead of the default bucket’s first row.
   */
  const pendingNewPoForPoCreatedTabRef = useRef<{
    supplierKey: SupplierKey;
    poId: string;
  } | null>(null);

  const [optimisticEmailSentAtByPoId, setOptimisticEmailSentAtByPoId] =
    useState<Record<string, string>>({});
  const [optimisticEmailWaivedAtByPoId, setOptimisticEmailWaivedAtByPoId] =
    useState<Record<string, string>>({});
  const [optimisticEmailWaivedClearPoIds, setOptimisticEmailWaivedClearPoIds] =
    useState<Record<string, true>>({});

  /** Hub PO status (`pending` / `unfulfilled`) until PUT completes and data refreshes. */
  const [optimisticPoHubStatusByPoId, setOptimisticPoHubStatusByPoId] =
    useState<Record<string, PurchaseOrderStatus>>({});

  /** `panelMeta` fields saved via MetaPanel PUT until server props refresh. */
  const [optimisticPoPanelEditByPoId, setOptimisticPoPanelEditByPoId] =
    useState<Record<string, OptimisticPoPanelEditPatch>>({});

  const [
    optimisticDeletedPurchaseOrderIds,
    setOptimisticDeletedPurchaseOrderIds,
  ] = useState(() => new Set<string>());

  const [lazyPoLineItems, setLazyPoLineItems] = useState<
    Record<string, PoLineItemView[]>
  >({});
  const [lazyPoLineItemsFetchFailed, setLazyPoLineItemsFetchFailed] = useState<
    Record<string, true>
  >({});
  const fetchedPoIdsRef = useRef(new Set<string>());
  const [lineItemRetryCount, setLineItemRetryCount] = useState(0);

  useEffect(() => {
    setOptimisticArchivedOrderIds(new Set());
    setOptimisticUnarchivedOrderIds(new Set());
    setOptimisticPoPatchesByKey({});
    setOptimisticEmailSentAtByPoId({});
    setOptimisticEmailWaivedAtByPoId({});
    setOptimisticEmailWaivedClearPoIds({});
    setOptimisticPoHubStatusByPoId({});
    setOptimisticPoPanelEditByPoId({});
    setOptimisticDeletedPurchaseOrderIds(new Set());
    setLazyPoLineItems({});
    setLazyPoLineItemsFetchFailed({});
    fetchedPoIdsRef.current.clear();
  }, [viewDataMap]);

  const viewDataAfterDraftArchive = useMemo(
    () =>
      mergeViewDataWithOptimisticDraftArchive(
        viewDataMap,
        optimisticArchivedOrderIds,
        optimisticUnarchivedOrderIds,
      ),
    [viewDataMap, optimisticArchivedOrderIds, optimisticUnarchivedOrderIds],
  );

  const supplierCompanyByKey = useMemo(() => {
    const m: Record<SupplierKey, string> = {};
    for (const [k, e] of Object.entries(states)) {
      if (e) m[k as SupplierKey] = e.supplierCompany;
    }
    return m;
  }, [states]);

  const optimisticPoPatchSets = useMemo(() => {
    const out: Partial<
      Record<
        SupplierKey,
        {
          newBlock: OfficePurchaseOrderBlock;
          removedDraftIds: ReadonlySet<string>;
        }
      >
    > = {};
    for (const [k, v] of Object.entries(optimisticPoPatchesByKey)) {
      if (!v) continue;
      out[k as SupplierKey] = {
        newBlock: v.newBlock,
        removedDraftIds: new Set(v.removedDraftIds),
      };
    }
    return out;
  }, [optimisticPoPatchesByKey]);

  const patchedViewDataMap = useMemo(() => {
    const afterPoCreates = mergeViewDataWithOptimisticPoCreates(
      viewDataAfterDraftArchive,
      optimisticPoPatchSets,
      supplierCompanyByKey,
    );
    const afterDeletes = mergeViewDataWithOptimisticPoDeletes(
      afterPoCreates,
      optimisticDeletedPurchaseOrderIds,
      supplierCompanyByKey,
    );
    const afterEmailSent = mergeViewDataWithOptimisticEmailSent(
      afterDeletes,
      optimisticEmailSentAtByPoId,
    );
    const waivedClearSet = new Set(
      Object.keys(optimisticEmailWaivedClearPoIds),
    );
    const afterEmailWaived = mergeViewDataWithOptimisticEmailWaived(
      afterEmailSent,
      optimisticEmailWaivedAtByPoId,
      waivedClearSet,
    );
    const afterPoHubStatus = mergeViewDataWithOptimisticPoHubStatus(
      afterEmailWaived,
      optimisticPoHubStatusByPoId,
    );
    const afterPoPanelEdit = mergeViewDataWithOptimisticPoPanelEdits(
      afterPoHubStatus,
      optimisticPoPanelEditByPoId,
    );
    return mergeViewDataWithLazyLineItems(afterPoPanelEdit, lazyPoLineItems);
  }, [
    viewDataAfterDraftArchive,
    optimisticPoPatchSets,
    supplierCompanyByKey,
    optimisticDeletedPurchaseOrderIds,
    optimisticEmailSentAtByPoId,
    optimisticEmailWaivedAtByPoId,
    optimisticEmailWaivedClearPoIds,
    optimisticPoHubStatusByPoId,
    optimisticPoPanelEditByPoId,
    lazyPoLineItems,
  ]);

  const patchedViewDataMapRef = useRef(patchedViewDataMap);
  patchedViewDataMapRef.current = patchedViewDataMap;

  const openPoFromTable = useCallback(
    async (poId: string) => {
      let key = findSupplierKeyForPurchaseOrderId(patchedViewDataMap, poId);
      if (!key) {
        try {
          const res = await fetch(
            `/api/order/table-view/resolve-po-key?id=${encodeURIComponent(poId)}`,
          );
          if (!res.ok) {
            toast.error('Could not resolve this PO.');
            return;
          }
          const body = (await res.json()) as { supplierKey?: string };
          key = (body.supplierKey as SupplierKey) ?? null;
        } catch {
          toast.error('Could not resolve this PO.');
          return;
        }
      }
      if (!key || !states[key]) {
        toast.error(
          'This PO is not in the current inbox. Open Grouped view or refresh the page.',
        );
        return;
      }
      setActiveKey(key);
      setSelectedPoBlockId(poId);
      setTablePoDetailPoId(poId);
    },
    [patchedViewDataMap, states],
  );

  useEffect(() => {
    if (
      !selectedPoBlockId ||
      selectedPoBlockId === '__drafts__' ||
      selectedPoBlockId === 'new'
    )
      return;
    if (fetchedPoIdsRef.current.has(selectedPoBlockId)) return;

    const vd = patchedViewDataMapRef.current[activeKey];
    if (!vd || vd.type !== 'post') return;
    const block = vd.purchaseOrders.find((p) => p.id === selectedPoBlockId);
    if (
      !block ||
      block.lineItems.length > 0 ||
      !block.panelMeta?.fulfillTotalCount
    )
      return;

    fetchedPoIdsRef.current.add(selectedPoBlockId);
    const poIdToFetch = selectedPoBlockId;

    setLazyPoLineItemsFetchFailed((prev) => {
      const next = { ...prev };
      delete next[poIdToFetch];
      return next;
    });

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), LAZY_PO_LINE_ITEMS_FETCH_MS);
    let cancelled = false;

    fetch(`/api/order/purchase-orders/${poIdToFetch}/line-items`, {
      signal: ac.signal,
    })
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then((data: { lineItems?: PoLineItemView[] }) => {
        if (cancelled) return;
        const lines = data.lineItems;
        if (Array.isArray(lines)) {
          setLazyPoLineItems((prev) => ({
            ...prev,
            [poIdToFetch]: lines,
          }));
          setLazyPoLineItemsFetchFailed((prev) => {
            const next = { ...prev };
            delete next[poIdToFetch];
            return next;
          });
        } else {
          fetchedPoIdsRef.current.delete(poIdToFetch);
          setLazyPoLineItemsFetchFailed((prev) => ({
            ...prev,
            [poIdToFetch]: true,
          }));
        }
      })
      .catch(() => {
        if (cancelled) return;
        fetchedPoIdsRef.current.delete(poIdToFetch);
        setLazyPoLineItemsFetchFailed((prev) => ({
          ...prev,
          [poIdToFetch]: true,
        }));
      })
      .finally(() => {
        clearTimeout(t);
      });

    return () => {
      cancelled = true;
      clearTimeout(t);
      ac.abort();
      fetchedPoIdsRef.current.delete(poIdToFetch);
    };
    // Re-run when server `viewDataMap` refreshes (reset clears lazy state) or when
    // `lazyPoLineItems` changes so we do not skip refetch after a clear vs stale ref.
  }, [
    viewDataMap,
    selectedPoBlockId,
    activeKey,
    lineItemRetryCount,
    lazyPoLineItems,
  ]);

  const handleReplyReceivedChange = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleRetryLineItemFetch = useCallback(() => {
    if (!selectedPoBlockId) return;
    fetchedPoIdsRef.current.delete(selectedPoBlockId);
    setLazyPoLineItemsFetchFailed((prev) => {
      const next = { ...prev };
      delete next[selectedPoBlockId];
      return next;
    });
    setLineItemRetryCount((c) => c + 1);
  }, [selectedPoBlockId]);

  const handleOptimisticPoEmailSent = useCallback((poId: string) => {
    setOptimisticEmailSentAtByPoId((prev) => ({
      ...prev,
      [poId]: new Date().toISOString(),
    }));
    setOptimisticEmailWaivedAtByPoId((prev) => {
      const next = { ...prev };
      delete next[poId];
      return next;
    });
    setOptimisticEmailWaivedClearPoIds((prev) => {
      const next = { ...prev };
      delete next[poId];
      return next;
    });
  }, []);

  const handlePoEmailDeliveryWaivedChange = useCallback(
    async (poId: string, waived: boolean) => {
      try {
        const res = await fetch(`/api/order/purchase-orders/${poId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailDeliveryWaived: waived }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          toast.error(
            typeof body?.error === 'string' ? body.error : 'Could not update',
          );
          return;
        }
        if (waived) {
          setOptimisticEmailWaivedClearPoIds((prev) => {
            const next = { ...prev };
            delete next[poId];
            return next;
          });
          setOptimisticEmailWaivedAtByPoId((prev) => ({
            ...prev,
            [poId]: new Date().toISOString(),
          }));
          toast.success('Reminder dismissed — not sending email for this PO.');
        } else {
          setOptimisticEmailWaivedAtByPoId((prev) => {
            const next = { ...prev };
            delete next[poId];
            return next;
          });
          setOptimisticEmailWaivedClearPoIds((prev) => ({
            ...prev,
            [poId]: true,
          }));
          toast.success('Send reminder restored for this PO.');
        }
        router.refresh();
      } catch {
        toast.error('Network error');
      }
    },
    [router],
  );

  /** After PO create: quick Print without leaving Inbox (send email stays in Meta / order panel). */
  const showPoCreatedFollowUpToast = useCallback(
    (
      block: OfficePurchaseOrderBlock,
      rowEntry: SupplierEntry,
      supplierKey: SupplierKey,
    ) => {
      const custKey = supplierKey.split('::')[0] ?? '';
      const group = customerGroups.find((c) => c.id === custKey);
      const printHeadline =
        group?.company?.trim() || group?.name?.trim() || null;

      const doPrint = () => {
        const input = buildPoPdfInput({
          block,
          supplierCompany: rowEntry.supplierCompany,
          customerHeadline: printHeadline,
          fallbackBillingAddress: group?.defaultBillingAddress ?? null,
          fallbackShippingAddress: group?.defaultShippingAddress ?? null,
        });
        if (input) openPoPdfPrint(input);
      };

      const doViewPo = () => {
        setMainPanel('grouped');
        pendingNewPoForPoCreatedTabRef.current = {
          supplierKey,
          poId: block.id,
        };
        setActiveStatusTab('po_created');
        setActiveKey(supplierKey);
        setSelectedPoBlockId(block.id);
      };

      toast.success(`PO #${block.poNumber} created`, {
        cancel: { label: 'View PO', onClick: doViewPo },
        action: { label: 'Print PO', onClick: doPrint },
      });
    },
    [customerGroups],
  );

  const tableCustomerFilterOptions = useMemo(
    () =>
      customerGroups
        .filter(
          (g) => g.id !== '__unknown_customer__' && !g.id.startsWith('email::'),
        )
        .map((g) => ({ id: g.id, label: g.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [customerGroups],
  );

  const tableSupplierFilterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const g of customerGroups) {
      for (const s of g.suppliers) {
        const supId = s.key.split('::')[1] ?? '';
        if (!supId || supId === 'without-po' || supId === '__unassigned__')
          continue;
        if (!byId.has(supId)) byId.set(supId, s.name);
      }
    }
    return [...byId.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [customerGroups]);

  const tableSupplierGroupFilterOptions = useMemo<OfficeTableFilterOption[]>(
    () =>
      supplierGroupFilterOptions
        .map((g) => ({ id: g.slug, label: g.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [supplierGroupFilterOptions],
  );

  const computedCounts = useMemo(() => {
    const counts = {
      without_po: 0,
      po_pending: 0,
      po_created: 0,
      fulfilled: 0,
      completed: 0,
      archived: 0,
    };
    for (const [key, e] of Object.entries(states)) {
      if (e.isArchived) {
        counts.archived++;
        continue;
      }
      if (e.withoutPoDraftCount > 0) counts.without_po++;
      const vd = patchedViewDataMap[key];
      if (supplierRowHasPendingPo(vd)) counts.po_pending++;
      if (e.poCreated && supplierRowHasOpenDeliveryPo(vd)) counts.po_created++;
      if (e.poCreated && supplierRowHasFulfilledListPo(vd) && !e.allCompleted) {
        counts.fulfilled++;
      }
      if (e.allCompleted) counts.completed++;
    }
    return counts;
  }, [states, patchedViewDataMap]);

  const statusTabs = useMemo(() => {
    const all: { id: StatusTab; label: string; count: number }[] = [
      { id: 'without_po', label: 'Inbox', count: computedCounts.without_po },
      {
        id: 'po_pending',
        label: 'PO pending',
        count: computedCounts.po_pending,
      },
      {
        id: 'po_created',
        label: 'PO created',
        count: computedCounts.po_created,
      },
      { id: 'fulfilled', label: 'Fulfilled', count: computedCounts.fulfilled },
    ];
    return all.filter((t) => t.id !== 'po_pending' || t.count > 0);
  }, [computedCounts]);

  const currentDrafts = useMemo(() => {
    const raw = patchedViewDataMap[activeKey];
    if (!raw) return [];
    const entryLocal = states[activeKey] ?? null;
    const list =
      entryLocal?.poCreated && raw.type === 'pre'
        ? raw.shopifyOrderDrafts
        : raw.type === 'pre'
          ? raw.shopifyOrderDrafts
          : (raw.shopifyOrderDrafts ?? []);
    const open = showArchived ? list : list.filter((d) => !d.archivedAt);
    if (activeStatusTab !== 'without_po') return open;
    const pos = raw.type === 'post' ? raw.purchaseOrders : undefined;
    return filterInboxDraftsForDisplay(open, pos);
  }, [patchedViewDataMap, activeKey, showArchived, activeStatusTab, states]);

  const metaInboxShopifyOrderIds = useMemo(
    () => currentDrafts.filter((d) => !d.archivedAt).map((d) => d.id),
    [currentDrafts],
  );

  const isReplacementOrderEntry = useMemo(
    () => currentDrafts.length > 0 && currentDrafts.every((d) => d.isCustomOrder),
    [currentDrafts],
  );

  const handleDeleteReplacementOrder = useCallback(async () => {
    const draft = currentDrafts.find((d) => d.isCustomOrder);
    if (!draft) return;
    const res = await fetch(`/api/order/custom-orders/${draft.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(body.error ?? 'Failed to delete replacement order');
      return;
    }
    toast.success('Replacement order deleted');
    router.refresh();
  }, [currentDrafts, router]);

  useEffect(() => {
    const inc: Record<string, boolean[]> = {};
    const notes: Record<string, string[]> = {};
    for (const d of currentDrafts) {
      inc[d.id] = d.lineItems.map((li) => li.includeInPo);
      notes[d.id] = d.lineItems.map((li) => li.defaultPoLineNote?.trim() ?? '');
    }
    setDraftInclusions(inc);
    setDraftLineNotes(notes);
    setPoNumberIsManual(false);
    setDraftPoNumber('');
  }, [activeKey, currentDrafts]);

  const autoPoNumber = useMemo(() => {
    const included = currentDrafts.filter((d) => {
      const inc = draftInclusions[d.id];
      return inc ? inc.some(Boolean) : d.lineItems.some((li) => li.includeInPo);
    });
    if (included.length === 0) return '';

    // Pick the order with the most included line items
    const topOrder = [...included].sort((a, b) => {
      const aCount = (
        draftInclusions[a.id] ?? a.lineItems.map((li) => li.includeInPo)
      ).filter(Boolean).length;
      const bCount = (
        draftInclusions[b.id] ?? b.lineItems.map((li) => li.includeInPo)
      ).filter(Boolean).length;
      return bCount - aCount;
    })[0];

    const custKey = activeKey.split('::')[0] ?? '';
    const custGroup = customerGroups.find((g) => g.id === custKey);
    const entry = states[activeKey];
    if (!custGroup || !entry) return '';

    return formatOfficeDefaultPoNumber({
      shopifyOrderNumber: topOrder.orderNumber,
      customerSegment: officeInboxCustomerPoSegment(custGroup),
      supplierSegment: officeInboxSupplierPoSegment(entry),
    });
  }, [currentDrafts, draftInclusions, activeKey, customerGroups, states]);

  const effectivePoNumber =
    poNumberIsManual && draftPoNumber ? draftPoNumber : autoPoNumber;

  const handleToggleInclude = useCallback(
    (orderId: string, itemIdx: number) => {
      setDraftInclusions((prev) => {
        const arr = [...(prev[orderId] ?? [])];
        arr[itemIdx] = !arr[itemIdx];
        return { ...prev, [orderId]: arr };
      });
    },
    [],
  );

  /** Inbox: every line on every visible draft order → include / exclude for PO create. */
  const handleSetAllLineIncludes = useCallback(
    (include: boolean) => {
      setDraftInclusions((prev) => {
        const next = { ...prev };
        for (const d of currentDrafts) {
          next[d.id] = d.lineItems.map(() => include);
        }
        return next;
      });
    },
    [currentDrafts],
  );

  const handleLineItemNoteChange = useCallback(
    (orderId: string, itemIdx: number, value: string) => {
      setDraftLineNotes((prev) => {
        const arr = [...(prev[orderId] ?? [])];
        arr[itemIdx] = value;
        return { ...prev, [orderId]: arr };
      });
    },
    [],
  );

  const handlePoNumberChange = useCallback((value: string) => {
    setDraftPoNumber(value);
    setPoNumberIsManual(true);
  }, []);

  const handlePoNumberReset = useCallback(() => {
    setDraftPoNumber('');
    setPoNumberIsManual(false);
  }, []);

  const handleCreatePo = useCallback(
    async (
      key: SupplierKey,
      payload?: CreatePoPayload,
    ): Promise<
      { ok: true } | { ok: false; reason: 'duplicate_po_number' | 'unknown' }
    > => {
      const entry = states[key];
      if (!entry) return { ok: false, reason: 'unknown' };

      const parts = key.split('::');
      const supplierId =
        parts.length >= 2 && parts[1] !== 'without-po' ? parts[1] : null;

      const raw = patchedViewDataMap[key];
      const entryLocal = states[key] ?? null;
      const drafts =
        entryLocal?.poCreated && raw?.type === 'pre'
          ? raw.shopifyOrderDrafts
          : raw?.type === 'pre'
            ? raw.shopifyOrderDrafts
            : (raw?.shopifyOrderDrafts ?? []);
      const openDrafts = showArchived
        ? drafts
        : drafts.filter((d) => !d.archivedAt);
      const filteredDrafts =
        activeStatusTab === 'without_po'
          ? filterInboxDraftsForDisplay(
              openDrafts,
              raw?.type === 'post' ? raw.purchaseOrders : undefined,
            )
          : openDrafts;

      const includedDrafts = filteredDrafts.filter((d) => {
        const inc = draftInclusions[d.id];
        return inc
          ? inc.some(Boolean)
          : d.lineItems.some((li) => li.includeInPo);
      });

      const shopifyOrderRefs = includedDrafts.map((d) => ({
        orderNumber: d.orderNumber,
      }));

      const lineItems = includedDrafts.flatMap((d) => {
        const inc = draftInclusions[d.id];
        const noteArr = draftLineNotes[d.id];
        return d.lineItems.flatMap((li, idx) => {
          if (inc && !inc[idx]) return [];
          return [
            {
              sku: li.sku,
              productTitle: li.productTitle,
              quantity: li.quantity,
              itemPrice: li.itemPrice ? parseFloat(li.itemPrice) : null,
              supplierRef: supplierRefFromSku(li.sku),
              isCustom: !li.shopifyVariantGid,
              shopifyLineItemId: li.shopifyLineItemId ?? null,
              shopifyLineItemGid: li.shopifyLineItemGid ?? null,
              shopifyVariantGid: li.shopifyVariantGid ?? null,
              shopifyProductGid: li.shopifyProductGid ?? null,
              note: (noteArr?.[idx] ?? '').trim(),
            },
          ];
        });
      });

      try {
        const res = await fetch('/api/order/purchase-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            poNumber: effectivePoNumber || 'AUTO',
            supplierId,
            currency: 'CAD',
            expectedDate: payload?.expectedDate ?? null,
            comment: payload?.comment ?? null,
            lineItems,
            shopifyOrderRefs,
            shippingAddress: payload?.shippingAddress ?? null,
            billingAddress: payload?.billingAddress ?? null,
            billingSameAsShipping: payload?.billingSameAsShipping ?? true,
            deliveryLocationPresetId:
              payload?.deliveryLocationPresetId ?? undefined,
            hubPending: payload?.hubPending === true,
          }),
        });

        if (res.ok) {
          const body = (await res.json().catch(() => null)) as {
            officeBlock?: OfficePurchaseOrderBlock;
          } | null;
          const officeBlock = body?.officeBlock?.id ? body.officeBlock : null;
          if (officeBlock) {
            const removedDraftIds = includedDrafts.map((d) => d.id);
            setOptimisticPoPatchesByKey((prev) => ({
              ...prev,
              [key]: { newBlock: officeBlock, removedDraftIds },
            }));
            setStates((prev) => {
              const e = prev[key];
              if (!e) return prev;
              return {
                ...prev,
                [key]: patchSupplierEntryAfterPoCreate({
                  entry: e,
                  newBlock: officeBlock,
                  removedDraftIds: new Set(removedDraftIds),
                  removedDrafts: includedDrafts,
                }),
              };
            });
            setSelectedPoBlockId(officeBlock.id);
            if (payload?.hubPending === true) {
              pendingPoNavigationRef.current = {
                supplierKey: key,
                poId: officeBlock.id,
              };
              setMainPanel('grouped');
              setShowArchived(false);
              setActivePeriod('all');
              setActiveStatusTab('po_pending');
              toast.success(
                `PO #${officeBlock.poNumber} created as pending — listed under PO Pending.`,
              );
            } else {
              pendingNewPoForPoCreatedTabRef.current = {
                supplierKey: key,
                poId: officeBlock.id,
              };
              showPoCreatedFollowUpToast(officeBlock, entry, key);
            }
          }
          router.refresh();
          return { ok: true };
        }
        const body = await res.json().catch(() => null);
        console.error('Create PO failed:', body?.error ?? res.statusText);
        if (res.status === 409 && body?.code === 'PO_NUMBER_TAKEN') {
          return { ok: false, reason: 'duplicate_po_number' };
        }
        if (body?.error) toast.error(String(body.error));
        return { ok: false, reason: 'unknown' };
      } catch (err) {
        console.error('Create PO error:', err);
        return { ok: false, reason: 'unknown' };
      }
    },
    [
      states,
      patchedViewDataMap,
      draftInclusions,
      draftLineNotes,
      effectivePoNumber,
      router,
      customerGroups,
      activeStatusTab,
      showArchived,
      showPoCreatedFollowUpToast,
    ],
  );

  const handleSeparatePo = useCallback(
    async (payload: SeparatePoPayload) => {
      const entry = states[activeKey];
      if (!entry) return;

      const parts = activeKey.split('::');
      const supplierId =
        parts.length >= 2 && parts[1] !== 'without-po' ? parts[1] : null;

      const raw = patchedViewDataMap[activeKey];
      const entryLocalSp = states[activeKey] ?? null;
      const drafts =
        entryLocalSp?.poCreated && raw?.type === 'pre'
          ? raw.shopifyOrderDrafts
          : raw?.type === 'pre'
            ? raw.shopifyOrderDrafts
            : (raw?.shopifyOrderDrafts ?? []);
      const openDraftsSp = showArchived
        ? drafts
        : drafts.filter((d) => !d.archivedAt);
      const draftPool =
        activeStatusTab === 'without_po'
          ? filterInboxDraftsForDisplay(
              openDraftsSp,
              raw?.type === 'post' ? raw.purchaseOrders : undefined,
            )
          : openDraftsSp;
      const targetNorm = payload.shopifyOrderNumber.replace(/^#/, '').trim();
      const matchedDraft = draftPool.find(
        (d) => d.orderNumber.replace(/^#/, '').trim() === targetNorm,
      );

      const poNumberForCreate = payload.poNumber.trim()
        ? payload.poNumber.trim()
        : 'AUTO';

      try {
        const res = await fetch('/api/order/purchase-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            poNumber: poNumberForCreate,
            supplierId,
            currency: 'CAD',
            expectedDate: payload.expectedDate,
            comment: payload.comment,
            lineItems: payload.lineItems.map((li) => ({
              sku: li.sku,
              productTitle: li.productTitle,
              quantity: li.quantity,
              itemPrice: li.itemPrice,
              supplierRef: supplierRefFromSku(li.sku),
              isCustom: li.isCustom ?? false,
              shopifyLineItemId: li.shopifyLineItemId ?? null,
              shopifyLineItemGid: li.shopifyLineItemGid ?? null,
              shopifyVariantGid: li.shopifyVariantGid ?? null,
              shopifyProductGid: li.shopifyProductGid ?? null,
              note: li.note != null ? String(li.note).trim() : '',
            })),
            shopifyOrderRefs: [{ orderNumber: payload.shopifyOrderNumber }],
            shippingAddress: payload.shippingAddress ?? undefined,
            billingSameAsShipping: true,
            deliveryLocationPresetId:
              payload.deliveryLocationPresetId ?? undefined,
          }),
        });

        if (res.ok) {
          const body = (await res.json().catch(() => null)) as {
            officeBlock?: OfficePurchaseOrderBlock;
          } | null;
          const officeBlock = body?.officeBlock?.id ? body.officeBlock : null;
          if (officeBlock) {
            const removedDraftIds = matchedDraft ? [matchedDraft.id] : [];
            pendingNewPoForPoCreatedTabRef.current = {
              supplierKey: activeKey,
              poId: officeBlock.id,
            };
            setOptimisticPoPatchesByKey((prev) => ({
              ...prev,
              [activeKey]: { newBlock: officeBlock, removedDraftIds },
            }));
            setStates((prev) => {
              const e = prev[activeKey];
              if (!e) return prev;
              return {
                ...prev,
                [activeKey]: patchSupplierEntryAfterPoCreate({
                  entry: e,
                  newBlock: officeBlock,
                  removedDraftIds: new Set(removedDraftIds),
                  removedDrafts: matchedDraft ? [matchedDraft] : [],
                }),
              };
            });
            setSelectedPoBlockId(officeBlock.id);
            showPoCreatedFollowUpToast(officeBlock, entry, activeKey);
          }
          router.refresh();
          return;
        }
        const body = await res.json().catch(() => null);
        console.error('Separate PO failed:', body?.error ?? res.statusText);
        if (res.status === 409 && body?.code === 'PO_NUMBER_TAKEN') {
          toast.error(
            'This PO number is already in use. Change the PO number in the dialog and try again.',
          );
        } else if (body?.error) {
          toast.error(String(body.error));
        }
      } catch (err) {
        console.error('Separate PO error:', err);
      }
    },
    [
      states,
      activeKey,
      router,
      patchedViewDataMap,
      activeStatusTab,
      showArchived,
      showPoCreatedFollowUpToast,
    ],
  );

  const handleEditPo = useCallback(
    async (
      poId: string,
      fields: EditPoFields,
    ): Promise<
      { ok: true } | { ok: false; reason: 'duplicate_po_number' | 'unknown' }
    > => {
      const definedFieldKeys = (
        Object.keys(fields) as (keyof EditPoFields)[]
      ).filter((k) => fields[k] !== undefined);
      const isHubStatusOnlyPut =
        definedFieldKeys.length === 1 &&
        definedFieldKeys[0] === 'status' &&
        fields.status != null;
      const nextHubStatus = isHubStatusOnlyPut ? fields.status! : null;

      if (isHubStatusOnlyPut && nextHubStatus) {
        setOptimisticPoHubStatusByPoId((prev) => ({
          ...prev,
          [poId]: nextHubStatus,
        }));
      }

      const panelPatch = isHubStatusOnlyPut
        ? null
        : panelPatchFromEditPoFields(fields);
      if (panelPatch) {
        setOptimisticPoPanelEditByPoId((prev) => ({
          ...prev,
          [poId]: { ...(prev[poId] ?? {}), ...panelPatch },
        }));
      }

      const rollbackHubStatusOptimistic = () => {
        if (!isHubStatusOnlyPut) return;
        setOptimisticPoHubStatusByPoId((prev) => {
          const { [poId]: _, ...rest } = prev;
          return rest;
        });
      };

      const rollbackPanelEditOptimistic = () => {
        if (!panelPatch) return;
        setOptimisticPoPanelEditByPoId((prev) => {
          const { [poId]: _, ...rest } = prev;
          return rest;
        });
      };

      try {
        const res = await fetch(`/api/order/purchase-orders/${poId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        });
        const body = await res.json().catch(() => null);

        if (res.ok) {
          if (isHubStatusOnlyPut && nextHubStatus) {
            toast.success(
              nextHubStatus === 'pending'
                ? 'PO marked as pending'
                : 'PO pending cleared',
            );
            if (nextHubStatus === 'pending') {
              const supplierKey = findSupplierKeyForPurchaseOrderId(
                patchedViewDataMap,
                poId,
              );
              if (supplierKey) {
                pendingPoNavigationRef.current = {
                  supplierKey,
                  poId,
                };
              }
              setActiveStatusTab((tab) =>
                tab === 'without_po' || tab === 'inbox' || tab === 'po_created'
                  ? 'po_pending'
                  : tab,
              );
              setActivePeriod('all');
            }
          }
          router.refresh();
          return { ok: true };
        }

        rollbackHubStatusOptimistic();
        rollbackPanelEditOptimistic();

        console.error('Edit PO failed:', body?.error ?? res.statusText);
        if (res.status === 409 && body?.code === 'PO_NUMBER_TAKEN') {
          return { ok: false, reason: 'duplicate_po_number' };
        }

        if (isHubStatusOnlyPut) {
          toast.error(
            typeof body?.error === 'string'
              ? body.error
              : 'Could not update PO status',
          );
        } else if (body?.error) {
          toast.error(String(body.error));
        }

        return { ok: false, reason: 'unknown' };
      } catch (err) {
        rollbackHubStatusOptimistic();
        rollbackPanelEditOptimistic();
        console.error('Edit PO error:', err);
        if (isHubStatusOnlyPut) {
          toast.error('Could not update PO status');
        }
        return { ok: false, reason: 'unknown' };
      }
    },
    [router, patchedViewDataMap],
  );

  const handleDeletePo = useCallback(
    async (poId: string) => {
      let supplierKey: SupplierKey | null = null;
      let deleted: OfficePurchaseOrderBlock | undefined;
      let entrySnapshot: SupplierEntry | undefined;

      for (const [key, vd] of Object.entries(patchedViewDataMap)) {
        if (vd.type !== 'post') continue;
        const b = vd.purchaseOrders.find((p) => p.id === poId);
        if (b) {
          supplierKey = key;
          deleted = b;
          entrySnapshot = states[key]
            ? { ...states[key as SupplierKey] }
            : undefined;
          break;
        }
      }

      const remainingReal = (() => {
        if (!supplierKey) return [] as OfficePurchaseOrderBlock[];
        const vd = patchedViewDataMap[supplierKey];
        if (!vd || vd.type !== 'post') return [];
        return vd.purchaseOrders.filter((p) => p.id !== poId && p.id !== 'new');
      })();

      if (supplierKey && deleted && entrySnapshot) {
        setOptimisticDeletedPurchaseOrderIds((prev) => {
          const next = new Set(prev);
          next.add(poId);
          return next;
        });
        setStates((prev) => {
          const e = prev[supplierKey!];
          if (!e) return prev;
          return {
            ...prev,
            [supplierKey!]: patchSupplierEntryAfterPoDelete({
              entry: e,
              deleted,
              remainingPoBlocks: remainingReal,
            }),
          };
        });
        setOptimisticPoPatchesByKey((prev) => {
          const p = prev[supplierKey!];
          if (p?.newBlock.id === poId) {
            const { [supplierKey!]: _, ...rest } = prev;
            return rest;
          }
          return prev;
        });
      }

      setOptimisticEmailSentAtByPoId((prev) => {
        if (!(poId in prev)) return prev;
        const { [poId]: _, ...rest } = prev;
        return rest;
      });

      if (pendingNewPoForPoCreatedTabRef.current?.poId === poId) {
        pendingNewPoForPoCreatedTabRef.current = null;
      }

      setSelectedPoBlockId((sel) => (sel === poId ? null : sel));

      const rollbackOptimistic = () => {
        setOptimisticDeletedPurchaseOrderIds((prev) => {
          const next = new Set(prev);
          next.delete(poId);
          return next;
        });
        if (supplierKey && entrySnapshot) {
          setStates((prev) => ({ ...prev, [supplierKey!]: entrySnapshot }));
        }
      };

      try {
        const res = await fetch(`/api/order/purchase-orders/${poId}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          router.refresh();
          return;
        }
        rollbackOptimistic();
        const body = await res.json().catch(() => null);
        console.error('Delete PO failed:', body?.error ?? res.statusText);
      } catch (err) {
        rollbackOptimistic();
        console.error('Delete PO error:', err);
      }
    },
    [patchedViewDataMap, states, router],
  );

  const handleUnarchive = useCallback(
    async (key: SupplierKey) => {
      const e = states[key];
      if (!e) return;

      const snapshot = { ...e };
      const shopifyIds = [...e.archiveShopifyOrderIds];

      const vd = viewDataMap[key];
      const draftRestoreCount =
        vd?.type === 'pre'
          ? vd.shopifyOrderDrafts.length
          : (vd?.shopifyOrderDrafts?.length ?? 0);

      setOptimisticUnarchivedOrderIds((prev) => {
        const next = new Set(prev);
        for (const id of shopifyIds) next.add(id);
        return next;
      });
      setOptimisticArchivedOrderIds((prev) => {
        const next = new Set(prev);
        for (const id of shopifyIds) next.delete(id);
        return next;
      });

      setStates((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          isArchived: false,
          ...(draftRestoreCount > 0
            ? { withoutPoDraftCount: draftRestoreCount }
            : {}),
        },
      }));

      try {
        const res = await fetch('/api/order/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purchaseOrderIds:
              e.archivePurchaseOrderIds.length > 0
                ? e.archivePurchaseOrderIds
                : undefined,
            shopifyOrderIds:
              e.archiveShopifyOrderIds.length > 0
                ? e.archiveShopifyOrderIds
                : undefined,
            archive: false,
          }),
        });
        if (!res.ok)
          throw new Error(await res.text().catch(() => res.statusText));
        router.refresh();
      } catch (err) {
        setStates((prev) => ({ ...prev, [key]: snapshot }));
        setOptimisticUnarchivedOrderIds((prev) => {
          const next = new Set(prev);
          for (const id of shopifyIds) next.delete(id);
          return next;
        });
        console.error('Unarchive error:', err);
      }
    },
    [states, router, viewDataMap],
  );

  const handleArchiveSupplierRow = useCallback(
    async (key: SupplierKey) => {
      const e = states[key];
      if (!e) return;
      const confirmed = window.confirm(
        'Archive this supplier row? Linked Shopify orders and POs are hidden until you turn on “Show archived”.',
      );
      if (!confirmed) return;

      const snapshot = { ...e };
      const shopifyIds = [...e.archiveShopifyOrderIds];
      const poIds = [...e.archivePurchaseOrderIds];

      setOptimisticArchivedOrderIds((prev) => {
        const next = new Set(prev);
        for (const id of shopifyIds) next.add(id);
        return next;
      });
      setOptimisticUnarchivedOrderIds((prev) => {
        const next = new Set(prev);
        for (const id of shopifyIds) next.delete(id);
        return next;
      });

      setStates((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          isArchived: true,
          withoutPoDraftCount: 0,
        },
      }));

      try {
        const res = await fetch('/api/order/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purchaseOrderIds: poIds.length > 0 ? poIds : undefined,
            shopifyOrderIds: shopifyIds.length > 0 ? shopifyIds : undefined,
            archive: true,
          }),
        });
        if (!res.ok)
          throw new Error(await res.text().catch(() => res.statusText));
        router.refresh();
      } catch (err) {
        setStates((prev) => ({ ...prev, [key]: snapshot }));
        setOptimisticArchivedOrderIds((prev) => {
          const next = new Set(prev);
          for (const id of shopifyIds) next.delete(id);
          return next;
        });
        console.error('Archive supplier row error:', err);
        toast.error('Could not archive');
      }
    },
    [states, router],
  );

  const handleArchivePurchaseOrder = useCallback(
    async (poId: string) => {
      if (!poId || poId === '__drafts__' || poId === 'new') return;
      const confirmed = window.confirm(
        'Archive this PO? It is hidden from open lists until you show archived items.',
      );
      if (!confirmed) return;
      try {
        const res = await fetch('/api/order/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purchaseOrderIds: [poId],
            archive: true,
          }),
        });
        if (!res.ok) {
          toast.error('Could not archive PO');
          return;
        }
        setSelectedPoBlockId((sel) => (sel === poId ? null : sel));
        router.refresh();
      } catch (err) {
        console.error('Archive PO error:', err);
        toast.error('Could not archive PO');
      }
    },
    [router],
  );

  const handleUnarchiveShopifyOrder = useCallback(
    async (shopifyOrderDbId: string) => {
      const key = activeKey;
      const entryBefore = states[key];

      setOptimisticUnarchivedOrderIds((prev) =>
        new Set(prev).add(shopifyOrderDbId),
      );
      setOptimisticArchivedOrderIds((prev) => {
        const n = new Set(prev);
        n.delete(shopifyOrderDbId);
        return n;
      });

      if (entryBefore) {
        setStates((prev) => {
          const e = prev[key];
          if (!e) return prev;
          return {
            ...prev,
            [key]: {
              ...e,
              withoutPoDraftCount: e.withoutPoDraftCount + 1,
              ...(!e.poCreated ? { isArchived: false } : {}),
            },
          };
        });
      }

      try {
        const res = await fetch('/api/order/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopifyOrderIds: [shopifyOrderDbId],
            archive: false,
          }),
        });
        if (!res.ok)
          throw new Error(await res.text().catch(() => res.statusText));
        router.refresh();
      } catch (err) {
        setOptimisticUnarchivedOrderIds((prev) => {
          const n = new Set(prev);
          n.delete(shopifyOrderDbId);
          return n;
        });
        if (entryBefore) {
          setStates((prev) => ({ ...prev, [key]: { ...entryBefore } }));
        }
        console.error('Unarchive Shopify order error:', err);
      }
    },
    [router, activeKey, states],
  );

  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  useEffect(() => {
    if (!showArchived) return;
    setActivePeriod('all');
    setCustomFrom('');
    setCustomTo('');
  }, [showArchived]);

  const { tabPeriods, moreExpectedPeriods, dateLabel } = useMemo(() => {
    if (showArchived) {
      return {
        tabPeriods: [] as Period[],
        moreExpectedPeriods: [] as Period[],
        dateLabel: 'Ordered at',
      };
    }

    // PO Created tab in "PO Created" date mode — chip dates from poCreatedAt
    if (
      activeStatusTab === 'po_created' &&
      poCreatedDateMode === 'po_created'
    ) {
      const dateSet = new Set<string>();
      for (const [key, entry] of Object.entries(states)) {
        if (entry.isArchived) continue;
        const vd = patchedViewDataMap[key];
        if (!entry.poCreated || !supplierRowHasOpenDeliveryPo(vd)) continue;
        if (vd?.type !== 'post') continue;
        for (const po of vd.purchaseOrders) {
          if (po.id === 'new' || isOfficePoDeliveryDone(po)) continue;
          const d = po.poCreatedAt?.slice(0, 10);
          if (d) dateSet.add(d);
        }
      }
      const allPresets: Period[] = [...dateSet]
        .sort()
        .reverse()
        .map((d) => {
          let displayLabel: string;
          try {
            displayLabel = formatOfficeDateChip(d);
          } catch {
            displayLabel = d;
          }
          return { id: `po_created_${d}`, label: displayLabel, from: d, to: d };
        });
      return {
        tabPeriods: allPresets.slice(0, MAX_EXPECTED_DATE_CHIPS),
        moreExpectedPeriods: allPresets.slice(MAX_EXPECTED_DATE_CHIPS),
        dateLabel: 'PO Created',
      };
    }

    if (
      activeStatusTab === 'po_pending' ||
      activeStatusTab === 'po_created' ||
      activeStatusTab === 'fulfilled' ||
      activeStatusTab === 'completed'
    ) {
      const dateSet = new Set<string>();
      for (const [key, entry] of Object.entries(states)) {
        if (entry.isArchived) continue;
        const vd = patchedViewDataMap[key];
        let inTab = false;
        switch (activeStatusTab) {
          case 'po_pending':
            inTab = supplierRowHasPendingPo(vd);
            break;
          case 'po_created':
            inTab = entry.poCreated && supplierRowHasOpenDeliveryPo(vd);
            break;
          case 'fulfilled':
            inTab =
              entry.poCreated &&
              supplierRowHasFulfilledListPo(vd) &&
              !entry.allCompleted;
            break;
          case 'completed':
            inTab = entry.allCompleted;
            break;
          default:
            break;
        }
        if (!inTab) continue;
        if (activeStatusTab === 'completed') {
          for (const d of entry.expectedDates) {
            if (d) dateSet.add(d);
          }
        } else if (activeStatusTab === 'po_pending') {
          for (const d of expectedDateKeysForPoPendingTab(vd)) {
            if (d) dateSet.add(d);
          }
        } else {
          for (const d of expectedDateKeysForPoTab(
            vd,
            activeStatusTab === 'po_created' ? 'po_created' : 'fulfilled',
          )) {
            if (d) dateSet.add(d);
          }
        }
      }
      const sortedAsc = [...dateSet].sort();
      const newestFirst = [...sortedAsc].reverse();
      const allPresets: Period[] = newestFirst.map((d) => {
        let displayLabel: string;
        try {
          displayLabel = formatOfficeDateChip(d);
        } catch {
          displayLabel = d;
        }
        return { id: `expected_${d}`, label: displayLabel, from: d, to: d };
      });
      return {
        tabPeriods: allPresets.slice(0, MAX_EXPECTED_DATE_CHIPS),
        moreExpectedPeriods: allPresets.slice(MAX_EXPECTED_DATE_CHIPS),
        dateLabel: 'Delivery Expected',
      };
    }

    if (activeStatusTab === 'inbox' || activeStatusTab === 'without_po') {
      const dateSet = new Set<string>();
      for (const entry of Object.values(states)) {
        if (entry.isArchived) continue;
        if (entry.withoutPoDraftCount <= 0) continue;
        if (entry.latestOrderedAt) dateSet.add(entry.latestOrderedAt);
      }
      const newestFirst = [...dateSet].sort().reverse();
      const allPresets: Period[] = newestFirst.map((d) => {
        let displayLabel: string;
        try {
          displayLabel = formatVancouverYmdChip(d);
        } catch {
          displayLabel = d;
        }
        return { id: `ordered_${d}`, label: displayLabel, from: d, to: d };
      });
      return {
        tabPeriods: allPresets.slice(0, MAX_EXPECTED_DATE_CHIPS),
        moreExpectedPeriods: allPresets.slice(MAX_EXPECTED_DATE_CHIPS),
        dateLabel: 'Ordered',
      };
    }

    return {
      tabPeriods: periods,
      moreExpectedPeriods: [] as Period[],
      dateLabel: 'Period',
    };
  }, [
    activeStatusTab,
    showArchived,
    states,
    periods,
    patchedViewDataMap,
    poCreatedDateMode,
  ]);

  const matchesStatusTab = useCallback(
    (e: SupplierEntry, vd: ViewData | undefined, tab: StatusTab): boolean => {
      if (showArchived) return e.isArchived;
      if (e.isArchived) return false;
      switch (tab) {
        case 'inbox':
        case 'without_po':
          return e.withoutPoDraftCount > 0;
        case 'po_pending':
          return supplierRowHasPendingPo(vd);
        case 'po_created':
          return e.poCreated && supplierRowHasOpenDeliveryPo(vd);
        case 'fulfilled':
          return (
            e.poCreated && supplierRowHasFulfilledListPo(vd) && !e.allCompleted
          );
        case 'completed':
          return e.allCompleted;
        default:
          return false;
      }
    },
    [showArchived],
  );

  const getDateForTab = useCallback(
    (e: SupplierEntry, tab: StatusTab): string | null => {
      switch (tab) {
        case 'inbox':
        case 'without_po':
          return e.latestOrderedAt;
        case 'po_pending':
        case 'po_created':
          return e.expectedDate;
        case 'fulfilled':
          return e.fulfilledAt;
        case 'completed':
          return e.completedAt;
        default:
          return e.dateCreated;
      }
    },
    [],
  );

  const handlePeriodChange = useCallback((id: PeriodKey) => {
    setActivePeriod(id);
    if (id === 'all') {
      setCustomFrom('');
      setCustomTo('');
    }
  }, []);

  const handlePoCreatedDateModeChange = useCallback((mode: string) => {
    setPoCreatedDateMode(mode as 'delivery_expected' | 'po_created');
    setActivePeriod('all');
    setCustomFrom('');
    setCustomTo('');
  }, []);

  const handleAlertStripNavigate = useCallback(
    (it: PoEmailDeliveryAlertItem) => {
      const entry = states[it.supplierKey];
      const vd = patchedViewDataMap[it.supplierKey];
      const po =
        vd?.type === 'post'
          ? vd.purchaseOrders.find((p) => p.id === it.purchaseOrderId)
          : undefined;
      if (!entry || !po) return;
      const tab = pickStatusTabForEmailAlertPo({ entry, vd, po });
      setMainPanel('grouped');
      pendingPoNavigationRef.current = {
        supplierKey: it.supplierKey,
        poId: it.purchaseOrderId,
      };
      setShowArchived(false);
      setActivePeriod('all');
      setActiveStatusTab(tab);
    },
    [states, patchedViewDataMap],
  );

  const handleOfficePendingOrderStripNavigate = useCallback(
    (it: OfficePendingOrderAlertItem) => {
      setMainPanel('grouped');
      setShowArchived(false);
      setActivePeriod('all');
      setActiveStatusTab('po_pending');
      pendingPoNavigationRef.current = {
        supplierKey: it.supplierKey,
        poId: it.purchaseOrderId,
      };
    },
    [],
  );

  useEffect(() => {
    if (activeStatusTab !== 'po_pending') return;
    if (computedCounts.po_pending > 0) return;
    setActiveStatusTab('without_po');
    setActivePeriod('all');
  }, [activeStatusTab, computedCounts.po_pending]);

  const matchesPeriod = useCallback(
    (
      supplierKey: SupplierKey,
      e: SupplierEntry,
      period: PeriodKey,
    ): boolean => {
      if (period === 'all') return true;

      if (showArchived && e.isArchived) {
        if (period === 'custom') {
          if (!customFrom && !customTo) return true;
          const raw = e.latestOrderedAt;
          if (!raw) return false;
          const day = raw.slice(0, 10);
          return (
            (!customFrom || day >= customFrom) && (!customTo || day <= customTo)
          );
        }
        return true;
      }

      if (period.startsWith('po_created_')) {
        const target = period.replace('po_created_', '');
        const vd = patchedViewDataMap[supplierKey];
        if (vd?.type !== 'post') return false;
        return vd.purchaseOrders.some(
          (po) =>
            po.id !== 'new' &&
            !isOfficePoDeliveryDone(po) &&
            po.poCreatedAt?.startsWith(target),
        );
      }

      if (period.startsWith('expected_')) {
        const target = period.replace('expected_', '');
        if (activeStatusTab === 'po_pending') {
          return expectedDateKeysForPoPendingTab(
            patchedViewDataMap[supplierKey],
          ).includes(target);
        }
        if (activeStatusTab === 'po_created') {
          return expectedDateKeysForPoTab(
            patchedViewDataMap[supplierKey],
            'po_created',
          ).includes(target);
        }
        if (activeStatusTab === 'fulfilled') {
          return expectedDateKeysForPoTab(
            patchedViewDataMap[supplierKey],
            'fulfilled',
          ).includes(target);
        }
        return e.expectedDates.includes(target);
      }

      if (period.startsWith('ordered_')) {
        const target = period.replace('ordered_', '');
        if (activeStatusTab === 'inbox' || activeStatusTab === 'without_po') {
          const draftDays = shopifyDraftOrderedDaysForKey(
            supplierKey,
            patchedViewDataMap,
          );
          return draftDays.has(target) || e.latestOrderedAt === target;
        }
        return e.latestOrderedAt === target;
      }

      if (period === 'custom') {
        if (!customFrom && !customTo) return true;
        // PO Created tab in po_created date mode — range by poCreatedAt
        if (
          activeStatusTab === 'po_created' &&
          poCreatedDateMode === 'po_created'
        ) {
          const vd = patchedViewDataMap[supplierKey];
          if (vd?.type !== 'post') return false;
          return vd.purchaseOrders.some((po) => {
            if (po.id === 'new' || isOfficePoDeliveryDone(po)) return false;
            const d = po.poCreatedAt?.slice(0, 10);
            if (!d) return false;
            return (
              (!customFrom || d >= customFrom) && (!customTo || d <= customTo)
            );
          });
        }
        if (
          activeStatusTab === 'po_pending' ||
          activeStatusTab === 'po_created' ||
          activeStatusTab === 'fulfilled' ||
          activeStatusTab === 'completed'
        ) {
          const dateKeys =
            activeStatusTab === 'completed'
              ? e.expectedDates
              : activeStatusTab === 'po_pending'
                ? expectedDateKeysForPoPendingTab(
                    patchedViewDataMap[supplierKey],
                  )
                : expectedDateKeysForPoTab(
                    patchedViewDataMap[supplierKey],
                    activeStatusTab === 'po_created'
                      ? 'po_created'
                      : 'fulfilled',
                  );
          return dateKeys.some(
            (ed) =>
              !!ed &&
              (!customFrom || ed >= customFrom) &&
              (!customTo || ed <= customTo),
          );
        }
        if (activeStatusTab === 'inbox' || activeStatusTab === 'without_po') {
          for (const day of shopifyDraftOrderedDaysForKey(
            supplierKey,
            patchedViewDataMap,
          )) {
            if (
              (!customFrom || day >= customFrom) &&
              (!customTo || day <= customTo)
            ) {
              return true;
            }
          }
          return false;
        }
        const d = getDateForTab(e, activeStatusTab);
        if (!d) return false;
        return (!customFrom || d >= customFrom) && (!customTo || d <= customTo);
      }
      const p = tabPeriods.find((pp) => pp.id === period);
      if (!p) return true;
      if (activeStatusTab === 'inbox' || activeStatusTab === 'without_po') {
        for (const day of shopifyDraftOrderedDaysForKey(
          supplierKey,
          patchedViewDataMap,
        )) {
          if (day >= p.from && day <= p.to) return true;
        }
      }
      const d = getDateForTab(e, activeStatusTab);
      if (!d) return false;
      return d >= p.from && d <= p.to;
    },
    [
      showArchived,
      customFrom,
      customTo,
      tabPeriods,
      activeStatusTab,
      getDateForTab,
      patchedViewDataMap,
      poCreatedDateMode,
    ],
  );

  const expectedDateBucketPoFilter = useMemo(():
    | ((po: OfficePurchaseOrderBlock) => boolean)
    | undefined => {
    if (activeStatusTab === 'po_pending') {
      return (po) =>
        po.id !== 'new' && !po.archivedAt && po.status === 'pending';
    }
    if (activeStatusTab === 'po_created') {
      return (po) => po.id !== 'new' && !isOfficePoDeliveryDone(po);
    }
    if (activeStatusTab === 'fulfilled') {
      return (po) =>
        po.id !== 'new' &&
        isOfficePoDeliveryDone(po) &&
        po.status !== 'completed';
    }
    return undefined;
  }, [activeStatusTab]);

  // Tab + period filtered groups (before supplier group filter).
  const tabPeriodFilteredGroups = useMemo(() => {
    const groups = customerGroups
      .map((g) => ({
        ...g,
        suppliers: g.suppliers.filter((s) => {
          const e = states[s.key];
          if (!e) return false;
          const vd = patchedViewDataMap[s.key];
          return (
            matchesStatusTab(e, vd, activeStatusTab) &&
            matchesPeriod(s.key, e, activePeriod)
          );
        }),
      }))
      .filter((g) => g.suppliers.length > 0);

    if (!showArchived) return groups;

    const sorted = [...groups].sort((a, b) => {
      const da = a.latestOrderDate ?? '';
      const db = b.latestOrderDate ?? '';
      if (da > db) return -1;
      if (da < db) return 1;
      return 0;
    });

    return sorted.map((g) => ({
      ...g,
      suppliers: [...g.suppliers].sort((sa, sb) => {
        const ea = states[sa.key]?.latestOrderedAt ?? '';
        const eb = states[sb.key]?.latestOrderedAt ?? '';
        return eb.localeCompare(ea);
      }),
    }));
  }, [
    customerGroups,
    states,
    activeStatusTab,
    activePeriod,
    showArchived,
    patchedViewDataMap,
    matchesStatusTab,
    matchesPeriod,
  ]);

  const filteredGroups = useMemo(() => {
    if (!activeSupplierGroupSlug) return tabPeriodFilteredGroups;
    return tabPeriodFilteredGroups
      .map((g) => ({
        ...g,
        suppliers: g.suppliers.filter((s) => {
          const e = states[s.key];
          return e?.supplierGroupSlug === activeSupplierGroupSlug;
        }),
      }))
      .filter((g) => g.suppliers.length > 0);
  }, [tabPeriodFilteredGroups, activeSupplierGroupSlug, states]);

  const supplierFirstInboxGroups = useMemo(
    () =>
      sidebarHierarchy === 'supplier_first'
        ? buildSupplierFirstGroups(filteredGroups, states)
        : null,
    [sidebarHierarchy, filteredGroups, states],
  );

  const usePoCreatedBuckets =
    activeStatusTab === 'po_created' && poCreatedDateMode === 'po_created';

  /**
   * When the status tab changes or the current supplier row is no longer in the
   * filtered sidebar, select the default row for this tab (Inbox → first supplier +
   * drafts; PO tabs → first PO in the newest expected-date bucket, matching sidebar order).
   * Keeps one effect so a follow-up “repair” effect does not clear `selectedPoBlockId`.
   */
  useEffect(() => {
    /** Alert strip: apply PO focus even when Table view is open (handler switches to Grouped). */
    const pending = pendingPoNavigationRef.current;
    if (pending) {
      pendingPoNavigationRef.current = null;
      const visible = filteredGroups.some((g) =>
        g.suppliers.some((s) => s.key === pending.supplierKey),
      );
      if (visible) {
        setActiveKey(pending.supplierKey);
        setSelectedPoBlockId(pending.poId);
        /**
         * Alert handler already updated `activeStatusTab` before this effect runs.
         * If we return early without syncing `prevStatusTabRef`, the next effect pass
         * still sees an old ref → `tabChanged` stays true → `setSelectedPoBlockId(null)`
         * runs and clears the PO we just focused.
         */
        prevStatusTabRef.current = activeStatusTab;
        return;
      }
    }

    if (mainPanel === 'table') return;

    const tabChanged =
      prevStatusTabRef.current != null &&
      prevStatusTabRef.current !== activeStatusTab;
    prevStatusTabRef.current = activeStatusTab;

    if (tabChanged && activeStatusTab !== 'po_created') {
      pendingNewPoForPoCreatedTabRef.current = null;
    }

    const postCreatePick = pendingNewPoForPoCreatedTabRef.current;
    if (activeStatusTab === 'po_created' && postCreatePick) {
      const vd = patchedViewDataMap[postCreatePick.supplierKey];
      const poExists =
        vd?.type === 'post' &&
        vd.purchaseOrders.some((p) => p.id === postCreatePick.poId);
      const visible = filteredGroups.some((g) =>
        g.suppliers.some((s) => s.key === postCreatePick.supplierKey),
      );
      if (!visible) {
        pendingNewPoForPoCreatedTabRef.current = null;
      } else if (poExists) {
        pendingNewPoForPoCreatedTabRef.current = null;
        setActiveKey(postCreatePick.supplierKey);
        setSelectedPoBlockId(postCreatePick.poId);
        return;
      } else if (tabChanged) {
        setActiveKey(postCreatePick.supplierKey);
        return;
      } else {
        pendingNewPoForPoCreatedTabRef.current = null;
      }
    }

    const stillVisible = filteredGroups.some((g) =>
      g.suppliers.some((s) => s.key === activeKey),
    );

    // Customer still in sidebar — check if selected PO disappeared (e.g. after fulfill moved it
    // to a different tab). If so, stay on this customer and pick their next PO.
    if (stillVisible && !tabChanged) {
      if (
        selectedPoBlockId &&
        selectedPoBlockId !== '__drafts__' &&
        activeStatusTab !== 'without_po'
      ) {
        const currentVd = patchedViewDataMap[activeKey];
        const poStillPresent =
          currentVd?.type === 'post' &&
          currentVd.purchaseOrders.some((p) => p.id === selectedPoBlockId);
        if (!poStillPresent && currentVd?.type === 'post') {
          const filter = expectedDateBucketPoFilter;
          const candidates = currentVd.purchaseOrders.filter(
            (p) => p.id !== 'new' && (!filter || filter(p)),
          );
          const next =
            candidates[0] ??
            currentVd.purchaseOrders.find((p) => p.id !== 'new');
          if (next) {
            setSelectedPoBlockId(next.id);
            return;
          }
          // No more POs for this customer — fall through to default selection below.
        } else {
          return;
        }
      } else {
        return;
      }
    }

    if (activeStatusTab === 'without_po') {
      setSelectedPoBlockId('__drafts__');
      const first = filteredGroups[0]?.suppliers[0];
      if (first) setActiveKey(first.key);
      else setActiveKey('');
      return;
    }

    setSelectedPoBlockId(null);

    const bucketOpts = {
      onlyExpectedDateKey: activePeriod.startsWith('expected_')
        ? activePeriod.replace('expected_', '')
        : activePeriod.startsWith('po_created_')
          ? activePeriod.replace('po_created_', '')
          : null,
      bucketStyle: showArchived
        ? ('ordered' as const)
        : ('delivery_expected' as const),
      includePo: expectedDateBucketPoFilter,
      bucketByField: usePoCreatedBuckets ? ('po_created' as const) : undefined,
    };
    const buckets = buildExpectedDateBuckets(
      filteredGroups,
      patchedViewDataMap,
      bucketOpts,
    );
    const fromNewest = pickFirstPoInNewestExpectedBucket(
      buckets,
      patchedViewDataMap,
    );
    if (fromNewest) {
      setActiveKey(fromNewest.supplierKey);
      setSelectedPoBlockId(fromNewest.poId);
      return;
    }

    const first = filteredGroups[0]?.suppliers[0];
    if (!first) {
      setActiveKey('');
      return;
    }
    setActiveKey(first.key);
    const raw = patchedViewDataMap[first.key];
    if (raw?.type === 'post' && raw.purchaseOrders.length > 0) {
      const filter = expectedDateBucketPoFilter;
      const candidates = raw.purchaseOrders.filter(
        (p) => p.id !== 'new' && (!filter || filter(p)),
      );
      const pick =
        candidates[0] ?? raw.purchaseOrders.find((p) => p.id !== 'new');
      if (pick) setSelectedPoBlockId(pick.id);
    }
  }, [
    activeKey,
    selectedPoBlockId,
    activeStatusTab,
    activePeriod,
    showArchived,
    filteredGroups,
    patchedViewDataMap,
    expectedDateBucketPoFilter,
    mainPanel,
  ]);

  /** Bucket key for the selected PO — scopes sidebar highlight to one date section. */
  const selectionExpectedDateKey = useMemo(() => {
    if (!selectedPoBlockId || selectedPoBlockId === '__drafts__') return null;
    const vd = patchedViewDataMap[activeKey];
    if (!vd || vd.type !== 'post') return null;
    const po = vd.purchaseOrders.find((p) => p.id === selectedPoBlockId);
    if (!po) return null;
    if (usePoCreatedBuckets) {
      return po.poCreatedAt ? po.poCreatedAt.slice(0, 10) : '__none__';
    }
    return expectedDateKeyFromPo(po.panelMeta?.expectedDate ?? null);
  }, [activeKey, selectedPoBlockId, patchedViewDataMap, usePoCreatedBuckets]);

  /** Inbox tab (without draft archive view): customer-first sidebar. Else: expected-date buckets. */
  const useInboxCustomerLayout =
    activeStatusTab === 'without_po' && !showArchived;

  const allExpectedBuckets = useMemo(() => {
    if (useInboxCustomerLayout) return null;
    const onlyKey = activePeriod.startsWith('expected_')
      ? activePeriod.replace('expected_', '')
      : activePeriod.startsWith('po_created_')
        ? activePeriod.replace('po_created_', '')
        : null;
    return buildExpectedDateBuckets(filteredGroups, patchedViewDataMap, {
      onlyExpectedDateKey: onlyKey,
      bucketStyle: showArchived ? 'ordered' : 'delivery_expected',
      includePo: expectedDateBucketPoFilter,
      bucketByField: usePoCreatedBuckets ? 'po_created' : undefined,
    });
  }, [
    useInboxCustomerLayout,
    filteredGroups,
    patchedViewDataMap,
    activePeriod,
    showArchived,
    expectedDateBucketPoFilter,
    usePoCreatedBuckets,
  ]);

  useEffect(() => {
    if (mainPanel === 'table') return;
    if (useInboxCustomerLayout || !activePeriod.startsWith('expected_')) return;
    if (!allExpectedBuckets?.length) return;

    const valid = allExpectedBuckets.some((bucket) =>
      bucket.customerGroups.some((cg) =>
        cg.suppliers.some(
          (s) =>
            s.key === activeKey &&
            selectedPoBlockId &&
            selectedPoBlockId !== '__drafts__' &&
            s.visiblePoIds.includes(selectedPoBlockId),
        ),
      ),
    );
    if (valid) return;

    const firstBucket = allExpectedBuckets[0];
    const firstCg = firstBucket.customerGroups[0];
    const firstSup = firstCg?.suppliers[0];
    if (!firstSup?.visiblePoIds?.length) return;
    setActiveKey(firstSup.key);
    setSelectedPoBlockId(firstSup.visiblePoIds[0]);
  }, [
    useInboxCustomerLayout,
    activePeriod,
    allExpectedBuckets,
    activeKey,
    selectedPoBlockId,
    mainPanel,
  ]);

  const [expectedDateSidebarPage, setExpectedDateSidebarPage] = useState(0);

  const expectedDateSidebarPageCount = useMemo(() => {
    if (!allExpectedBuckets?.length) return 1;
    return Math.max(
      1,
      Math.ceil(allExpectedBuckets.length / EXPECTED_DATE_SIDEBAR_PAGE_SIZE),
    );
  }, [allExpectedBuckets]);

  const pagedExpectedBuckets = useMemo(() => {
    if (!allExpectedBuckets) return null;
    const start = expectedDateSidebarPage * EXPECTED_DATE_SIDEBAR_PAGE_SIZE;
    return allExpectedBuckets.slice(
      start,
      start + EXPECTED_DATE_SIDEBAR_PAGE_SIZE,
    );
  }, [allExpectedBuckets, expectedDateSidebarPage]);

  useEffect(() => {
    setExpectedDateSidebarPage(0);
  }, [activeStatusTab, showArchived, activePeriod, filteredGroups]);

  useEffect(() => {
    if (mainPanel === 'table') return;
    if (useInboxCustomerLayout || !allExpectedBuckets?.length) return;
    if (
      selectedPoBlockId === '__drafts__' ||
      selectedPoBlockId === null ||
      selectedPoBlockId === undefined
    ) {
      return;
    }
    const page = findBucketPageIndex(
      allExpectedBuckets,
      EXPECTED_DATE_SIDEBAR_PAGE_SIZE,
      activeKey,
      selectedPoBlockId,
    );
    setExpectedDateSidebarPage(page);
  }, [
    activeKey,
    selectedPoBlockId,
    allExpectedBuckets,
    useInboxCustomerLayout,
    mainPanel,
  ]);

  const entry = states[activeKey] ?? null;

  const rawViewData = entry ? patchedViewDataMap[activeKey] : undefined;

  const viewData: ViewData =
    entry && entry.poCreated && rawViewData?.type === 'pre'
      ? ({
          type: 'post',
          purchaseOrders: [
            {
              id: 'new',
              poNumber: 'NEW',
              status: 'unfulfilled',
              currency: 'CAD',
              isAuto: false,
              title: 'Items for PO',
              shopifyOrderCount: rawViewData.shopifyOrderDrafts.filter(
                (d) => !d.archivedAt,
              ).length,
              lineItems: [],
              supplierOrderChannelType: entry.supplierOrderChannelType,
              poCreatedAt: new Date().toISOString(),
              legacyExternalId: null,
              emailDeliveryOutstanding: false,
              customOrderCount: 0,
            },
          ],
        } satisfies PostViewData)
      : (rawViewData ?? { type: 'pre' as const, shopifyOrderDrafts: [] });

  useEffect(() => {
    if (mainPanel === 'table') return;
    if (!entry) return;
    const raw = patchedViewDataMap[activeKey];
    if (!raw) return;

    const draftList =
      raw.type === 'pre'
        ? raw.shopifyOrderDrafts
        : (raw.shopifyOrderDrafts ?? []);
    const draftCount = draftList.filter((d) => !d.archivedAt).length;

    if (
      activeStatusTab !== 'po_pending' &&
      draftCount > 0 &&
      (activeStatusTab === 'without_po' || activeStatusTab === 'inbox')
    ) {
      // Default to drafts for inbox work, but keep a real PO selected when it still
      // exists (e.g. right after create — print in meta, then pick next inbox lines).
      setSelectedPoBlockId((prev) => {
        if (prev && prev !== '__drafts__' && prev !== 'new') {
          const purchaseOrders = raw.type === 'post' ? raw.purchaseOrders : [];
          if (purchaseOrders.some((p) => p.id === prev && p.id !== 'new')) {
            return prev;
          }
        }
        return '__drafts__';
      });
      return;
    }

    const vd =
      entry.poCreated && raw.type === 'pre'
        ? ({
            type: 'post',
            purchaseOrders: [
              {
                id: 'new',
                poNumber: 'NEW',
                status: 'unfulfilled',
                currency: 'CAD',
                isAuto: false,
                title: 'Items for PO',
                shopifyOrderCount: draftList.filter((d) => !d.archivedAt)
                  .length,
                lineItems: [],
                supplierOrderChannelType: entry.supplierOrderChannelType,
                poCreatedAt: new Date().toISOString(),
                legacyExternalId: null,
                emailDeliveryOutstanding: false,
                customOrderCount: 0,
              },
            ],
          } satisfies PostViewData)
        : raw;
    if (vd.type !== 'post') {
      setSelectedPoBlockId(null);
      return;
    }
    if (vd.purchaseOrders.length === 0) {
      setSelectedPoBlockId(null);
      return;
    }
    setSelectedPoBlockId((prev) => {
      const stillValid = prev && vd.purchaseOrders.some((b) => b.id === prev);
      if (stillValid) return prev;
      if (activeStatusTab === 'po_pending') {
        const pend = vd.purchaseOrders.find(
          (b) => b.id !== 'new' && !b.archivedAt && b.status === 'pending',
        );
        if (pend) return pend.id;
      }
      return vd.purchaseOrders[0].id;
    });
  }, [
    activeKey,
    activeStatusTab,
    entry?.poCreated,
    patchedViewDataMap,
    entry,
    mainPanel,
  ]);

  const centerPostViewData: ViewData = useMemo(() => {
    if (viewData.type !== 'post' || activeStatusTab !== 'po_pending')
      return viewData;
    const pendingOnly = viewData.purchaseOrders.filter(
      (p) => p.id !== 'new' && !p.archivedAt && p.status === 'pending',
    );
    if (pendingOnly.length === 0) return viewData;
    return { ...viewData, purchaseOrders: pendingOnly };
  }, [viewData, activeStatusTab]);

  let selectedPoPanelMeta: PoPanelMeta | undefined;
  if (centerPostViewData.type === 'post' && selectedPoBlockId) {
    selectedPoPanelMeta = centerPostViewData.purchaseOrders.find(
      (b) => b.id === selectedPoBlockId,
    )?.panelMeta;
  }

  const customerAddressDefaults = useMemo(() => {
    const custKey = activeKey.split('::')[0] ?? '';
    const group = customerGroups.find((g) => g.id === custKey);
    return {
      shipping: group?.defaultShippingAddress ?? null,
      billing: group?.defaultBillingAddress ?? null,
      billingSame: group?.billingSameAsShipping ?? true,
    };
  }, [activeKey, customerGroups]);

  /** Latest Vancouver order-day among included drafts — floor so expected date is not before any linked order. */
  const minExpectedYmdFromIncludedDrafts = useMemo(() => {
    const includedDrafts = currentDrafts.filter((d) => {
      const inc = draftInclusions[d.id];
      return inc ? inc.some(Boolean) : d.lineItems.some((li) => li.includeInPo);
    });
    const ymds = includedDrafts
      .map((d) => (d.orderedAt ? toVancouverYmdFromIso(d.orderedAt) : null))
      .filter((y): y is string => Boolean(y));
    if (ymds.length === 0) return null;
    return ymds.sort((a, b) => a.localeCompare(b)).at(-1)!;
  }, [currentDrafts, draftInclusions]);

  const defaultExpectedYmd = useMemo(() => {
    const creationYmd = toVancouverYmd(new Date());
    if (!entry) return creationYmd;
    /** Fallback only if `creationYmd` parse fails inside `computeDefaultExpectedYmd`. */
    const referenceYmd = entry.latestOrderedAt ?? creationYmd;
    let y = computeDefaultExpectedYmd({
      schedule: entry.deliverySchedule,
      referenceYmd,
      creationYmd,
    });
    if (
      minExpectedYmdFromIncludedDrafts &&
      y < minExpectedYmdFromIncludedDrafts
    ) {
      y = minExpectedYmdFromIncludedDrafts;
    }
    return y;
  }, [entry, minExpectedYmdFromIncludedDrafts]);

  const selectedPoPrintBlock =
    centerPostViewData.type === 'post' &&
    selectedPoBlockId &&
    selectedPoBlockId !== '__drafts__'
      ? (centerPostViewData.purchaseOrders.find(
          (b) => b.id === selectedPoBlockId,
        ) ?? null)
      : null;

  const poEmailDeliveryAlertItems = useMemo(
    () =>
      collectPoEmailDeliveryAlerts({
        viewDataMap: patchedViewDataMap,
        states,
        customerGroups,
      }),
    [patchedViewDataMap, states, customerGroups],
  );

  const officePendingOrderAlertItems = useMemo(
    () =>
      collectOfficePendingOrderAlerts({
        viewDataMap: patchedViewDataMap,
        states,
        customerGroups,
      }),
    [patchedViewDataMap, states, customerGroups],
  );

  const poPrintHeadline = useMemo(() => {
    const custKey = activeKey.split('::')[0] ?? '';
    const g = customerGroups.find((c) => c.id === custKey);
    return g?.company?.trim() || g?.name?.trim() || null;
  }, [activeKey, customerGroups]);

  const defaultSeparatePoNumberForOrder = useCallback(
    (order: ShopifyOrderDraft) => {
      const custKey = activeKey.split('::')[0] ?? '';
      const g = customerGroups.find((c) => c.id === custKey);
      const row = states[activeKey];
      if (!g || !row) return '';
      return formatOfficeDefaultPoNumber({
        shopifyOrderNumber: order.orderNumber,
        customerSegment: officeInboxCustomerPoSegment(g),
        supplierSegment: officeInboxSupplierPoSegment(row),
      });
    },
    [activeKey, customerGroups, states],
  );

  const lineItemsNeedsLazyFetch =
    !!selectedPoBlockId &&
    selectedPoBlockId !== '__drafts__' &&
    selectedPoBlockId !== 'new' &&
    selectedPoPrintBlock !== null &&
    (selectedPoPrintBlock?.lineItems.length ?? 0) === 0 &&
    (selectedPoPrintBlock?.panelMeta?.fulfillTotalCount ?? 0) > 0;

  const lineItemsLazyFetchFailed =
    !!selectedPoBlockId &&
    Boolean(lazyPoLineItemsFetchFailed[selectedPoBlockId]);

  const lineItemsLoading = lineItemsNeedsLazyFetch && !lineItemsLazyFetchFailed;

  const orderCenterAndMetaPanel = entry ? (
    <div className="flex min-w-0 flex-1 flex-col">
      <CenterBar
        entry={entry}
        activeKey={activeKey}
        poPanelMeta={selectedPoPanelMeta}
        selectedPoBlockId={selectedPoBlockId}
      />

      <OrderProcessingBlock
        entry={entry}
        includePoEmailTools={
          entry.poCreated && selectedPoBlockId !== '__drafts__'
        }
        poInternalNote={selectedPoPanelMeta?.comment ?? null}
        poEmailSentAt={selectedPoPanelMeta?.emailSentAt ?? null}
        poEmailDeliveryOutstanding={
          (activeStatusTab === 'po_created' ||
            activeStatusTab === 'po_pending') &&
          (selectedPoPrintBlock?.emailDeliveryOutstanding ?? false)
        }
        selectedPoBlockId={selectedPoBlockId}
        emailDeliveries={selectedPoPanelMeta?.emailDeliveries ?? []}
        onPoEmailSent={handleOptimisticPoEmailSent}
        onSendEmailComplete={() => router.refresh()}
        lineItemsLoading={lineItemsLoading}
        poEmailReplyReceivedAt={
          selectedPoPanelMeta?.emailReplyReceivedAt ?? null
        }
        onReplyReceivedChange={handleReplyReceivedChange}
        poEmailDeliveryWaivedAt={
          selectedPoPanelMeta?.emailDeliveryWaivedAt ?? null
        }
        onPoEmailDeliveryWaivedChange={handlePoEmailDeliveryWaivedChange}
      />

      <div className="flex min-h-0 flex-1 bg-muted/30">
        <div className="min-w-0 flex-1 overflow-y-auto p-3.5">
          {selectedPoBlockId === '__drafts__' && viewData.type === 'post' ? (
            currentDrafts.length > 0 ? (
              <PrePoView
                shopifyAdminStoreHandle={shopifyAdminStoreHandle}
                viewData={{
                  type: 'pre',
                  shopifyOrderDrafts: currentDrafts,
                }}
                defaultExpectedYmd={defaultExpectedYmd}
                inclusions={draftInclusions}
                onToggleInclude={handleToggleInclude}
                onSeparatePo={handleSeparatePo}
                showArchived={showArchived}
                onUnarchiveShopifyOrder={handleUnarchiveShopifyOrder}
                purchaseOrderId={
                  (
                    viewData.purchaseOrders.find((p) => p.id !== 'new') ??
                    viewData.purchaseOrders[0]
                  )?.id ?? null
                }
                draftLineNotes={draftLineNotes}
                onLineItemNoteChange={handleLineItemNoteChange}
                defaultSeparatePoNumberForOrder={
                  defaultSeparatePoNumberForOrder
                }
                onIncludeAllOrderLines={() => handleSetAllLineIncludes(true)}
                onExcludeAllOrderLines={() => handleSetAllLineIncludes(false)}
              />
            ) : (
              <div className="px-3 py-6 text-[11px] text-muted-foreground">
                No remaining Shopify lines for this supplier (all are already on
                a PO).
              </div>
            )
          ) : viewData.type === 'pre' ? (
            <PrePoView
              shopifyAdminStoreHandle={shopifyAdminStoreHandle}
              viewData={{
                type: 'pre',
                shopifyOrderDrafts: currentDrafts,
              }}
              defaultExpectedYmd={defaultExpectedYmd}
              inclusions={draftInclusions}
              onToggleInclude={handleToggleInclude}
              onSeparatePo={handleSeparatePo}
              showArchived={showArchived}
              onUnarchiveShopifyOrder={handleUnarchiveShopifyOrder}
              draftLineNotes={draftLineNotes}
              onLineItemNoteChange={handleLineItemNoteChange}
              defaultSeparatePoNumberForOrder={defaultSeparatePoNumberForOrder}
              onIncludeAllOrderLines={() => handleSetAllLineIncludes(true)}
              onExcludeAllOrderLines={() => handleSetAllLineIncludes(false)}
            />
          ) : (
            <PostPoView
              shopifyAdminStoreHandle={shopifyAdminStoreHandle}
              viewData={centerPostViewData as PostViewData}
              selectedPoBlockId={selectedPoBlockId}
              lineItemsLoading={lineItemsLoading}
              onRetryLineItems={handleRetryLineItemFetch}
              onEditPo={handleEditPo}
            />
          )}
        </div>
        <MetaPanel
          entry={entry}
          activeKey={activeKey}
          defaultExpectedYmd={defaultExpectedYmd}
          minExpectedYmdForDrafts={minExpectedYmdFromIncludedDrafts}
          onCreatePo={handleCreatePo}
          onEditPo={handleEditPo}
          onDeletePo={handleDeletePo}
          onPoEmailSent={handleOptimisticPoEmailSent}
          onPoEmailDeliveryWaivedChange={handlePoEmailDeliveryWaivedChange}
          poPanelMeta={selectedPoPanelMeta}
          selectedPoBlockId={selectedPoBlockId}
          onArchive={handleArchiveSupplierRow}
          onArchivePurchaseOrder={handleArchivePurchaseOrder}
          onUnarchive={handleUnarchive}
          draftPoNumber={effectivePoNumber}
          poNumberIsManual={poNumberIsManual}
          onPoNumberChange={handlePoNumberChange}
          onPoNumberReset={handlePoNumberReset}
          customerDefaultShipping={customerAddressDefaults.shipping}
          customerDefaultBilling={customerAddressDefaults.billing}
          customerBillingSameAsShipping={customerAddressDefaults.billingSame}
          poPrintBlock={selectedPoPrintBlock}
          poPrintHeadline={poPrintHeadline}
          lineItemsLoading={lineItemsLoading}
          inboxShopifyOrderIds={metaInboxShopifyOrderIds}
          onDeleteReplacementOrder={isReplacementOrderEntry ? handleDeleteReplacementOrder : undefined}
        />
      </div>
    </div>
  ) : (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center bg-muted/30">
      <span className="text-sm text-muted-foreground">No order selected</span>
    </div>
  );

  const navBtn =
    'w-full rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors';
  const navBtnActive =
    'bg-background text-foreground shadow-sm ring-1 ring-border';
  const navBtnIdle =
    'text-muted-foreground hover:bg-muted/60 hover:text-foreground';

  return (
    <div className="flex border border-border rounded-xl overflow-hidden bg-background min-h-[600px]">
      <nav
        className="flex w-[9.75rem] shrink-0 flex-col gap-1 border-r border-border bg-muted/25 p-2"
        aria-label="Office view"
      >
        <button
          type="button"
          className={cn(
            navBtn,
            mainPanel === 'grouped' ? navBtnActive : navBtnIdle,
          )}
          onClick={() => setMainPanel('grouped')}
        >
          Grouped view
        </button>
        <button
          type="button"
          className={cn(
            navBtn,
            mainPanel === 'table' ? navBtnActive : navBtnIdle,
          )}
          onClick={() => setMainPanel('table')}
        >
          Table view
        </button>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <PoEmailDeliveryAlertsStrip
          items={poEmailDeliveryAlertItems}
          onNavigateToPo={handleAlertStripNavigate}
          onSent={(poId) => {
            handleOptimisticPoEmailSent(poId);
            router.refresh();
          }}
          onEmailDeliveryWaivedChange={handlePoEmailDeliveryWaivedChange}
        />
        <OfficePendingOrdersAlertsStrip
          items={officePendingOrderAlertItems}
          onNavigateToPendingPo={handleOfficePendingOrderStripNavigate}
        />

        {shopifyAdminApiConfigured ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-b bg-muted/10 px-3 py-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setCreateShopifyOrderOpen(true)}
            >
              New Shopify order
            </Button>
          </div>
        ) : null}

        {mainPanel === 'table' ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {tablePoDetailPoId ? (
              <>
                <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => setTablePoDetailPoId(null)}
                  >
                    ← Table view
                  </Button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {orderCenterAndMetaPanel}
                </div>
              </>
            ) : (
              <OfficeTableSplitView
                shopifyAdminStoreHandle={shopifyAdminStoreHandle}
                shopifyCreateOrderEnabled={shopifyAdminApiConfigured}
                onRequestCreateShopifyOrder={() =>
                  setCreateShopifyOrderOpen(true)
                }
                initialShopifyRows={tableViewShopifyRows}
                initialPoRows={tableViewPoRows}
                shopifyTotal={tableViewShopifyTotal}
                poTotal={tableViewPoTotal}
                customerFilterOptions={tableCustomerFilterOptions}
                supplierFilterOptions={tableSupplierFilterOptions}
                supplierGroupFilterOptions={tableSupplierGroupFilterOptions}
                onOpenPoDetail={openPoFromTable}
              />
            )}
          </div>
        ) : (
          <>
            <StatusTabBar
              tabs={statusTabs}
              activeTab={activeStatusTab}
              onChange={(tab) => {
                setShowArchived(false);
                setActivePeriod('all');
                setActiveStatusTab(tab);
                setActiveSupplierGroupSlug(null);
              }}
              archivedCount={computedCounts.archived}
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived((v) => !v)}
            />
            <PeriodFilterBar
              key={showArchived ? 'archived-period' : 'main-period'}
              periods={tabPeriods}
              morePeriods={moreExpectedPeriods}
              activePeriod={activePeriod}
              onPeriodChange={handlePeriodChange}
              onCustomApply={(from, to) => {
                setCustomFrom(from);
                setCustomTo(to);
                setActivePeriod('custom');
              }}
              dateLabel={dateLabel}
              orderedDateOnly={showArchived}
              archiveFrom={showArchived ? customFrom : undefined}
              archiveTo={showArchived ? customTo : undefined}
              onArchiveFromChange={showArchived ? setCustomFrom : undefined}
              onArchiveToChange={showArchived ? setCustomTo : undefined}
              dateModeOptions={
                activeStatusTab === 'po_created' && !showArchived
                  ? [
                      {
                        value: 'delivery_expected',
                        label: 'Delivery Expected',
                      },
                      { value: 'po_created', label: 'PO Created' },
                    ]
                  : undefined
              }
              dateMode={
                activeStatusTab === 'po_created' ? poCreatedDateMode : undefined
              }
              onDateModeChange={
                activeStatusTab === 'po_created'
                  ? handlePoCreatedDateModeChange
                  : undefined
              }
              supplierGroupOptions={supplierGroupFilterOptions}
              activeSupplierGroupSlug={activeSupplierGroupSlug}
              onSupplierGroupChange={setActiveSupplierGroupSlug}
            />

            {(useInboxCustomerLayout ||
              activeStatusTab === 'po_pending' ||
              activeStatusTab === 'po_created' ||
              activeStatusTab === 'fulfilled' ||
              showArchived) && (
              <div className="flex shrink-0 items-center gap-2 border-b bg-muted/15 px-3 py-1.5">
                <span className="text-[10px] text-muted-foreground">
                  Sidebar
                </span>
                <div className="inline-flex rounded-md border border-border bg-background p-px text-[10px]">
                  <button
                    type="button"
                    className={cn(
                      'rounded px-2 py-1 font-medium transition-colors',
                      sidebarHierarchy === 'customer_first'
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setSidebarHierarchy('customer_first')}
                  >
                    Customer → Supplier
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded px-2 py-1 font-medium transition-colors',
                      sidebarHierarchy === 'supplier_first'
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setSidebarHierarchy('supplier_first')}
                  >
                    Supplier → Customer
                  </button>
                </div>
              </div>
            )}

            <div className="flex min-h-0 flex-1 overflow-hidden">
              <Sidebar
                layout={useInboxCustomerLayout ? 'customer' : 'expected_date'}
                customerGroups={filteredGroups}
                supplierFirstInboxGroups={supplierFirstInboxGroups}
                expectedDateBucketFirstColumn={
                  sidebarHierarchy === 'supplier_first'
                    ? 'supplier'
                    : 'customer'
                }
                expectedDateBuckets={
                  useInboxCustomerLayout
                    ? undefined
                    : (pagedExpectedBuckets ?? [])
                }
                expectedDatePage={expectedDateSidebarPage}
                expectedDatePageCount={expectedDateSidebarPageCount}
                onExpectedDatePageChange={setExpectedDateSidebarPage}
                activeKey={activeKey}
                states={states}
                viewDataMap={patchedViewDataMap}
                onSelect={setActiveKey}
                selectedPoBlockId={selectedPoBlockId}
                selectionExpectedDateKey={selectionExpectedDateKey}
                showArchived={showArchived}
                onSelectPo={(key, poBlockId) => {
                  setActiveKey(key);
                  setSelectedPoBlockId(poBlockId);
                }}
                activeStatusTab={activeStatusTab}
              />

              {orderCenterAndMetaPanel}
            </div>
          </>
        )}
      </div>

      {shopifyAdminApiConfigured ? (
        <CreateShopifyOrderDialog
          open={createShopifyOrderOpen}
          onOpenChange={setCreateShopifyOrderOpen}
          onCreated={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}
