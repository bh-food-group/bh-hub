'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  SupplierKey,
  SupplierEntry,
  ViewData,
  OfficePurchaseOrderBlock,
  PoLineItemView,
  PurchaseOrderStatus,
} from '../types';
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
import type { EditPoFields } from '../components/MetaPanel';

const LAZY_PO_LINE_ITEMS_FETCH_MS = 12_000;

function mergeViewDataWithOptimisticDraftArchive(
  viewDataMap: Record<string, ViewData>,
  optimisticArchived: ReadonlySet<string>,
  optimisticUnarchived: ReadonlySet<string>,
): Record<string, ViewData> {
  if (optimisticArchived.size === 0 && optimisticUnarchived.size === 0) return viewDataMap;
  const stamp = new Date().toISOString();
  let anyChange = false;
  const out: Record<string, ViewData> = { ...viewDataMap };
  for (const key of Object.keys(viewDataMap)) {
    const vd = viewDataMap[key];
    const drafts = vd.type === 'pre' ? vd.shopifyOrderDrafts : (vd.shopifyOrderDrafts ?? []);
    if (!drafts.length) continue;
    const next = drafts.map((d) => {
      const serverArchived = d.archivedAt ?? null;
      let archivedAt = serverArchived;
      if (optimisticUnarchived.has(d.id)) archivedAt = null;
      else if (optimisticArchived.has(d.id)) archivedAt = stamp;
      if (archivedAt === serverArchived) return d;
      return { ...d, archivedAt };
    });
    if (!next.some((d, i) => d !== drafts[i])) continue;
    anyChange = true;
    out[key] = vd.type === 'pre' ? { ...vd, shopifyOrderDrafts: next } : { ...vd, shopifyOrderDrafts: next };
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

export type OptimisticOrderActions = {
  markEmailSent: (poId: string) => void;
  setEmailWaived: (poId: string, waivedAt: string) => void;
  clearEmailWaived: (poId: string) => void;
  setPoHubStatus: (poId: string, status: PurchaseOrderStatus) => void;
  clearPoHubStatus: (poId: string) => void;
  applyPanelEdit: (poId: string, fields: EditPoFields) => OptimisticPoPanelEditPatch | null;
  rollbackPanelEdit: (poId: string) => void;
  applyPoCreate: (key: SupplierKey, block: OfficePurchaseOrderBlock, removedDraftIds: string[], setStates: (fn: (prev: Record<SupplierKey, SupplierEntry>) => Record<SupplierKey, SupplierEntry>) => void) => void;
  applyPoDelete: (poId: string, supplierKey: SupplierKey | null, deleted: OfficePurchaseOrderBlock | undefined, remainingPoBlocks: OfficePurchaseOrderBlock[], setStates: (fn: (prev: Record<SupplierKey, SupplierEntry>) => Record<SupplierKey, SupplierEntry>) => void) => void;
  rollbackPoDelete: (poId: string, supplierKey: SupplierKey | null, snapshot: SupplierEntry | undefined, setStates: (fn: (prev: Record<SupplierKey, SupplierEntry>) => Record<SupplierKey, SupplierEntry>) => void) => void;
  clearPoCreate: (key: SupplierKey, poId: string) => void;
  archiveDraft: (id: string) => void;
  unarchiveDraft: (ids: string[]) => void;
  removeDraftFromArchived: (ids: string[]) => void;
  retryLineItemFetch: (poId: string) => void;
};

export type OptimisticOrderState = {
  patchedViewDataMap: Record<SupplierKey, ViewData>;
  patchedViewDataMapRef: React.MutableRefObject<Record<SupplierKey, ViewData>>;
  optimisticArchivedOrderIds: ReadonlySet<string>;
  optimisticUnarchivedOrderIds: ReadonlySet<string>;
  optimisticDeletedPurchaseOrderIds: ReadonlySet<string>;
  lazyPoLineItemsFetchFailed: Record<string, true>;
  actions: OptimisticOrderActions;
};

export function useOptimisticOrderState(
  viewDataMap: Record<SupplierKey, ViewData>,
  states: Record<SupplierKey, SupplierEntry>,
  selectedPoBlockId: string | null,
  activeKey: SupplierKey,
): OptimisticOrderState {
  const [optimisticArchivedOrderIds, setOptimisticArchivedOrderIds] = useState(() => new Set<string>());
  const [optimisticUnarchivedOrderIds, setOptimisticUnarchivedOrderIds] = useState(() => new Set<string>());
  const [optimisticPoPatchesByKey, setOptimisticPoPatchesByKey] = useState<
    Partial<Record<SupplierKey, { newBlock: OfficePurchaseOrderBlock; removedDraftIds: string[] }>>
  >({});
  const [optimisticEmailSentAtByPoId, setOptimisticEmailSentAtByPoId] = useState<Record<string, string>>({});
  const [optimisticEmailWaivedAtByPoId, setOptimisticEmailWaivedAtByPoId] = useState<Record<string, string>>({});
  const [optimisticEmailWaivedClearPoIds, setOptimisticEmailWaivedClearPoIds] = useState<Record<string, true>>({});
  const [optimisticPoHubStatusByPoId, setOptimisticPoHubStatusByPoId] = useState<Record<string, PurchaseOrderStatus>>({});
  const [optimisticPoPanelEditByPoId, setOptimisticPoPanelEditByPoId] = useState<Record<string, OptimisticPoPanelEditPatch>>({});
  const [optimisticDeletedPurchaseOrderIds, setOptimisticDeletedPurchaseOrderIds] = useState(() => new Set<string>());
  const [lazyPoLineItems, setLazyPoLineItems] = useState<Record<string, PoLineItemView[]>>({});
  const [lazyPoLineItemsFetchFailed, setLazyPoLineItemsFetchFailed] = useState<Record<string, true>>({});
  const fetchedPoIdsRef = useRef(new Set<string>());
  const [lineItemRetryCount, setLineItemRetryCount] = useState(0);

  // Reset all optimistic state when the server refreshes its data
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

  const supplierCompanyByKey = useMemo(() => {
    const m: Record<SupplierKey, string> = {};
    for (const [k, e] of Object.entries(states)) {
      if (e) m[k as SupplierKey] = e.supplierCompany;
    }
    return m;
  }, [states]);

  const optimisticPoPatchSets = useMemo(() => {
    const out: Partial<Record<SupplierKey, { newBlock: OfficePurchaseOrderBlock; removedDraftIds: ReadonlySet<string> }>> = {};
    for (const [k, v] of Object.entries(optimisticPoPatchesByKey)) {
      if (!v) continue;
      out[k as SupplierKey] = { newBlock: v.newBlock, removedDraftIds: new Set(v.removedDraftIds) };
    }
    return out;
  }, [optimisticPoPatchesByKey]);

  const viewDataAfterDraftArchive = useMemo(
    () => mergeViewDataWithOptimisticDraftArchive(viewDataMap, optimisticArchivedOrderIds, optimisticUnarchivedOrderIds),
    [viewDataMap, optimisticArchivedOrderIds, optimisticUnarchivedOrderIds],
  );

  const patchedViewDataMap = useMemo(() => {
    const afterPoCreates = mergeViewDataWithOptimisticPoCreates(viewDataAfterDraftArchive, optimisticPoPatchSets, supplierCompanyByKey);
    const afterDeletes = mergeViewDataWithOptimisticPoDeletes(afterPoCreates, optimisticDeletedPurchaseOrderIds, supplierCompanyByKey);
    const afterEmailSent = mergeViewDataWithOptimisticEmailSent(afterDeletes, optimisticEmailSentAtByPoId);
    const waivedClearSet = new Set(Object.keys(optimisticEmailWaivedClearPoIds));
    const afterEmailWaived = mergeViewDataWithOptimisticEmailWaived(afterEmailSent, optimisticEmailWaivedAtByPoId, waivedClearSet);
    const afterPoHubStatus = mergeViewDataWithOptimisticPoHubStatus(afterEmailWaived, optimisticPoHubStatusByPoId);
    const afterPoPanelEdit = mergeViewDataWithOptimisticPoPanelEdits(afterPoHubStatus, optimisticPoPanelEditByPoId);
    return mergeViewDataWithLazyLineItems(afterPoPanelEdit, lazyPoLineItems);
  }, [
    viewDataAfterDraftArchive, optimisticPoPatchSets, supplierCompanyByKey,
    optimisticDeletedPurchaseOrderIds, optimisticEmailSentAtByPoId,
    optimisticEmailWaivedAtByPoId, optimisticEmailWaivedClearPoIds,
    optimisticPoHubStatusByPoId, optimisticPoPanelEditByPoId, lazyPoLineItems,
  ]);

  const patchedViewDataMapRef = useRef(patchedViewDataMap);
  patchedViewDataMapRef.current = patchedViewDataMap;

  // Lazy-load line items for the selected PO when needed
  useEffect(() => {
    if (!selectedPoBlockId || selectedPoBlockId === '__drafts__' || selectedPoBlockId === 'new') return;
    if (fetchedPoIdsRef.current.has(selectedPoBlockId)) return;

    const vd = patchedViewDataMapRef.current[activeKey];
    if (!vd || vd.type !== 'post') return;
    const block = vd.purchaseOrders.find((p) => p.id === selectedPoBlockId);
    if (!block || block.lineItems.length > 0 || !block.panelMeta?.fulfillTotalCount) return;

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

    fetch(`/api/order/purchase-orders/${poIdToFetch}/line-items`, { signal: ac.signal })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((data: { lineItems?: PoLineItemView[] }) => {
        if (cancelled) return;
        const lines = data.lineItems;
        if (Array.isArray(lines)) {
          setLazyPoLineItems((prev) => ({ ...prev, [poIdToFetch]: lines }));
          setLazyPoLineItemsFetchFailed((prev) => { const n = { ...prev }; delete n[poIdToFetch]; return n; });
        } else {
          fetchedPoIdsRef.current.delete(poIdToFetch);
          setLazyPoLineItemsFetchFailed((prev) => ({ ...prev, [poIdToFetch]: true }));
        }
      })
      .catch(() => {
        if (cancelled) return;
        fetchedPoIdsRef.current.delete(poIdToFetch);
        setLazyPoLineItemsFetchFailed((prev) => ({ ...prev, [poIdToFetch]: true }));
      })
      .finally(() => { clearTimeout(t); });

    return () => {
      cancelled = true;
      clearTimeout(t);
      ac.abort();
      fetchedPoIdsRef.current.delete(poIdToFetch);
    };
  }, [viewDataMap, selectedPoBlockId, activeKey, lineItemRetryCount, lazyPoLineItems]);

  const actions: OptimisticOrderActions = {
    markEmailSent: (poId) => {
      setOptimisticEmailSentAtByPoId((prev) => ({ ...prev, [poId]: new Date().toISOString() }));
      setOptimisticEmailWaivedAtByPoId((prev) => { const n = { ...prev }; delete n[poId]; return n; });
      setOptimisticEmailWaivedClearPoIds((prev) => { const n = { ...prev }; delete n[poId]; return n; });
    },
    setEmailWaived: (poId, waivedAt) => {
      setOptimisticEmailWaivedClearPoIds((prev) => { const n = { ...prev }; delete n[poId]; return n; });
      setOptimisticEmailWaivedAtByPoId((prev) => ({ ...prev, [poId]: waivedAt }));
    },
    clearEmailWaived: (poId) => {
      setOptimisticEmailWaivedAtByPoId((prev) => { const n = { ...prev }; delete n[poId]; return n; });
      setOptimisticEmailWaivedClearPoIds((prev) => ({ ...prev, [poId]: true }));
    },
    setPoHubStatus: (poId, status) => {
      setOptimisticPoHubStatusByPoId((prev) => ({ ...prev, [poId]: status }));
    },
    clearPoHubStatus: (poId) => {
      setOptimisticPoHubStatusByPoId((prev) => { const { [poId]: _, ...rest } = prev; return rest; });
    },
    applyPanelEdit: (poId, fields) => {
      const patch = panelPatchFromEditPoFields(fields);
      if (patch) setOptimisticPoPanelEditByPoId((prev) => ({ ...prev, [poId]: { ...(prev[poId] ?? {}), ...patch } }));
      return patch;
    },
    rollbackPanelEdit: (poId) => {
      setOptimisticPoPanelEditByPoId((prev) => { const { [poId]: _, ...rest } = prev; return rest; });
    },
    applyPoCreate: (key, block, removedDraftIds, setStates) => {
      setOptimisticPoPatchesByKey((prev) => ({ ...prev, [key]: { newBlock: block, removedDraftIds } }));
      setStates((prev) => {
        const e = prev[key];
        if (!e) return prev;
        return { ...prev, [key]: patchSupplierEntryAfterPoCreate({ entry: e, newBlock: block, removedDraftIds: new Set(removedDraftIds), removedDrafts: [] }) };
      });
    },
    applyPoDelete: (poId, supplierKey, deleted, remainingPoBlocks, setStates) => {
      setOptimisticDeletedPurchaseOrderIds((prev) => { const n = new Set(prev); n.add(poId); return n; });
      if (supplierKey && deleted) {
        setStates((prev) => {
          const e = prev[supplierKey];
          if (!e) return prev;
          return { ...prev, [supplierKey]: patchSupplierEntryAfterPoDelete({ entry: e, deleted, remainingPoBlocks }) };
        });
        setOptimisticPoPatchesByKey((prev) => {
          const p = prev[supplierKey];
          if (p?.newBlock.id === poId) { const { [supplierKey]: _, ...rest } = prev; return rest; }
          return prev;
        });
      }
      setOptimisticEmailSentAtByPoId((prev) => { if (!(poId in prev)) return prev; const { [poId]: _, ...rest } = prev; return rest; });
    },
    rollbackPoDelete: (poId, supplierKey, snapshot, setStates) => {
      setOptimisticDeletedPurchaseOrderIds((prev) => { const n = new Set(prev); n.delete(poId); return n; });
      if (supplierKey && snapshot) setStates((prev) => ({ ...prev, [supplierKey]: snapshot }));
    },
    clearPoCreate: (key, poId) => {
      setOptimisticPoPatchesByKey((prev) => {
        const p = prev[key];
        if (p?.newBlock.id === poId) { const { [key]: _, ...rest } = prev; return rest; }
        return prev;
      });
    },
    archiveDraft: (id) => {
      setOptimisticArchivedOrderIds((prev) => new Set(prev).add(id));
      setOptimisticUnarchivedOrderIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    },
    unarchiveDraft: (ids) => {
      setOptimisticUnarchivedOrderIds((prev) => { const n = new Set(prev); for (const id of ids) n.add(id); return n; });
      setOptimisticArchivedOrderIds((prev) => { const n = new Set(prev); for (const id of ids) n.delete(id); return n; });
    },
    removeDraftFromArchived: (ids) => {
      setOptimisticArchivedOrderIds((prev) => { const n = new Set(prev); for (const id of ids) n.delete(id); return n; });
    },
    retryLineItemFetch: (poId) => {
      fetchedPoIdsRef.current.delete(poId);
      setLazyPoLineItemsFetchFailed((prev) => { const n = { ...prev }; delete n[poId]; return n; });
      setLineItemRetryCount((c) => c + 1);
    },
  };

  return {
    patchedViewDataMap,
    patchedViewDataMapRef,
    optimisticArchivedOrderIds,
    optimisticUnarchivedOrderIds,
    optimisticDeletedPurchaseOrderIds,
    lazyPoLineItemsFetchFailed,
    actions,
  };
}
