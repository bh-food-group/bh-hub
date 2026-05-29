'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type {
  SupplierKey,
  SupplierEntry,
  ViewData,
  OfficePurchaseOrderBlock,
  ShopifyOrderDraft,
  SidebarCustomerGroup,
  StatusTab,
  PoPanelMeta,
} from '../types';
import type { CreatePoPayload, EditPoFields } from '../components/MetaPanel';
import type { SeparatePoPayload } from '../types';
import type { PurchaseOrderStatus } from '../types/purchase-order';
import type { OptimisticOrderActions } from './useOptimisticOrderState';
import { filterInboxDraftsForDisplay } from '../utils/filter-inbox-drafts-for-display';
import { buildPoPdfInput, openPoPdfPrint } from '../utils/purchase-order-pdf';
import {
  formatOfficeDefaultPoNumber,
  officeInboxCustomerPoSegment,
  officeInboxSupplierPoSegment,
} from '../utils/format-office-default-po-number';
import { findSupplierKeyForPurchaseOrderId } from '../utils/find-supplier-key-for-po';
import { patchSupplierEntryAfterPoCreate } from '../utils/merge-optimistic-po-create';

function supplierRefFromSku(sku: string | null | undefined): string | null {
  const t = sku?.trim();
  return t ? t : null;
}

function resolveSupplierIdFromKey(key: SupplierKey): string | null {
  const parts = key.split('::');
  const supPart = parts.length >= 2 ? parts[1] : null;
  return supPart && supPart !== 'without-po' && supPart !== '__unassigned__' ? supPart : null;
}

export type PoMutationContext = {
  states: Record<SupplierKey, SupplierEntry>;
  setStates: (fn: (prev: Record<SupplierKey, SupplierEntry>) => Record<SupplierKey, SupplierEntry>) => void;
  patchedViewDataMap: Record<SupplierKey, ViewData>;
  viewDataMap: Record<SupplierKey, ViewData>;
  activeKey: SupplierKey;
  activeStatusTab: StatusTab;
  showArchived: boolean;
  /** Ref to current draft list — avoids stale closure in handleDeleteReplacementOrder. */
  currentDraftsRef: React.MutableRefObject<ShopifyOrderDraft[]>;
  draftInclusions: Record<string, boolean[]>;
  draftLineNotes: Record<string, string[]>;
  /** Ref to effective PO number — avoids stale closure in handleCreatePo. */
  effectivePoNumberRef: React.MutableRefObject<string>;
  customerGroups: SidebarCustomerGroup[];
  actions: OptimisticOrderActions;
  pendingPoNavigationRef: React.MutableRefObject<{ supplierKey: SupplierKey; poId: string } | null>;
  pendingNewPoForPoCreatedTabRef: React.MutableRefObject<{ supplierKey: SupplierKey; poId: string } | null>;
  setActiveKey: (key: SupplierKey) => void;
  setActiveStatusTab: React.Dispatch<React.SetStateAction<StatusTab>>;
  setActivePeriod: (key: string) => void;
  setMainPanel: (panel: 'grouped' | 'table' | 'refunds') => void;
  setShowArchived: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedPoBlockId: React.Dispatch<React.SetStateAction<string | null>>;
  router: AppRouterInstance;
};

export function usePoMutations(ctx: PoMutationContext) {
  const {
    states, setStates, patchedViewDataMap, viewDataMap,
    activeKey, activeStatusTab, showArchived, currentDraftsRef,
    draftInclusions, draftLineNotes, effectivePoNumberRef, customerGroups,
    actions, pendingPoNavigationRef, pendingNewPoForPoCreatedTabRef,
    setActiveKey, setActiveStatusTab, setActivePeriod, setMainPanel,
    setShowArchived, setSelectedPoBlockId, router,
  } = ctx;

  const handleOptimisticPoEmailSent = useCallback((poId: string) => {
    actions.markEmailSent(poId);
  }, [actions]);

  const handleReplyReceivedChange = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleRetryLineItemFetch = useCallback((selectedPoBlockId: string | null) => {
    if (!selectedPoBlockId) return;
    actions.retryLineItemFetch(selectedPoBlockId);
  }, [actions]);

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
          toast.error(typeof body?.error === 'string' ? body.error : 'Could not update');
          return;
        }
        if (waived) {
          actions.setEmailWaived(poId, new Date().toISOString());
          toast.success('Reminder dismissed — not sending email for this PO.');
        } else {
          actions.clearEmailWaived(poId);
          toast.success('Send reminder restored for this PO.');
        }
        router.refresh();
      } catch {
        toast.error('Network error');
      }
    },
    [actions, router],
  );

  const showPoCreatedFollowUpToast = useCallback(
    (block: OfficePurchaseOrderBlock, rowEntry: SupplierEntry, supplierKey: SupplierKey) => {
      const custKey = supplierKey.split('::')[0] ?? '';
      const group = customerGroups.find((c) => c.id === custKey);
      const printHeadline = group?.company?.trim() || group?.name?.trim() || null;

      const doPrint = () => {
        const input = buildPoPdfInput({
          block,
          supplierCompany: rowEntry.supplierCompany,
          customerHeadline: printHeadline,
          fallbackBillingAddress: group?.defaultBillingAddress ?? null,
          fallbackShippingAddress: group?.defaultShippingAddress ?? null,
        });
        if (input) void openPoPdfPrint(input);
      };

      const doViewPo = () => {
        setMainPanel('grouped');
        pendingNewPoForPoCreatedTabRef.current = { supplierKey, poId: block.id };
        setActiveStatusTab('po_created');
        setActiveKey(supplierKey);
        setSelectedPoBlockId(block.id);
      };

      toast.success(`PO #${block.poNumber} created`, {
        cancel: { label: 'View PO', onClick: doViewPo },
        action: { label: 'Print PO', onClick: doPrint },
      });
    },
    [customerGroups, pendingNewPoForPoCreatedTabRef, setActiveKey, setActiveStatusTab, setMainPanel, setSelectedPoBlockId],
  );

  const handleCreatePo = useCallback(
    async (key: SupplierKey, payload?: CreatePoPayload): Promise<{ ok: true } | { ok: false; reason: 'duplicate_po_number' | 'unknown' }> => {
      const entry = states[key];
      if (!entry) return { ok: false, reason: 'unknown' };

      const supplierId = resolveSupplierIdFromKey(key);
      const raw = patchedViewDataMap[key];
      const entryLocal = states[key] ?? null;
      const drafts = entryLocal?.poCreated && raw?.type === 'pre'
        ? raw.shopifyOrderDrafts
        : raw?.type === 'pre' ? raw.shopifyOrderDrafts : (raw?.shopifyOrderDrafts ?? []);
      const openDrafts = showArchived ? drafts : drafts.filter((d) => !d.archivedAt);
      const filteredDrafts = activeStatusTab === 'without_po'
        ? filterInboxDraftsForDisplay(openDrafts, raw?.type === 'post' ? raw.purchaseOrders : undefined)
        : openDrafts;

      const includedDrafts = filteredDrafts.filter((d) => {
        const inc = draftInclusions[d.id];
        return inc ? inc.some(Boolean) : d.lineItems.some((li) => li.includeInPo);
      });

      const shopifyOrderRefs = includedDrafts.map((d) => ({ orderNumber: d.orderNumber }));
      const lineItems = includedDrafts.flatMap((d) => {
        const inc = draftInclusions[d.id];
        const noteArr = draftLineNotes[d.id];
        return d.lineItems.flatMap((li, idx) => {
          if (inc && !inc[idx]) return [];
          return [{
            sku: li.sku,
            productTitle: li.productTitle,
            variantTitle: li.variantTitle ?? null,
            quantity: li.quantity,
            itemPrice: li.itemPrice ? parseFloat(li.itemPrice) : null,
            supplierRef: supplierRefFromSku(li.sku),
            isCustom: !li.shopifyVariantGid,
            shopifyLineItemId: li.shopifyLineItemId ?? null,
            shopifyLineItemGid: li.shopifyLineItemGid ?? null,
            shopifyVariantGid: li.shopifyVariantGid ?? null,
            shopifyProductGid: li.shopifyProductGid ?? null,
            note: (noteArr?.[idx] ?? '').trim(),
          }];
        });
      });

      try {
        const res = await fetch('/api/order/purchase-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            poNumber: effectivePoNumberRef.current || 'AUTO',
            supplierId,
            currency: 'CAD',
            expectedDate: payload?.expectedDate ?? null,
            comment: payload?.comment ?? null,
            lineItems,
            shopifyOrderRefs,
            shippingAddress: payload?.shippingAddress ?? null,
            billingAddress: payload?.billingAddress ?? null,
            billingSameAsShipping: payload?.billingSameAsShipping ?? true,
            deliveryLocationPresetId: payload?.deliveryLocationPresetId ?? undefined,
            hubPending: payload?.hubPending === true,
          }),
        });

        if (res.ok) {
          const body = (await res.json().catch(() => null)) as { officeBlock?: OfficePurchaseOrderBlock } | null;
          const officeBlock = body?.officeBlock?.id ? body.officeBlock : null;
          if (officeBlock) {
            const removedDraftIds = includedDrafts.map((d) => d.id);
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
            actions.applyPoCreate(key, officeBlock, removedDraftIds, () => {/* already set above */});
            setSelectedPoBlockId(officeBlock.id);
            if (payload?.hubPending === true) {
              pendingPoNavigationRef.current = { supplierKey: key, poId: officeBlock.id };
              setMainPanel('grouped');
              setShowArchived(false);
              setActivePeriod('all');
              setActiveStatusTab('po_pending');
              toast.success(`PO #${officeBlock.poNumber} created as pending — listed under PO Pending.`);
            } else {
              pendingNewPoForPoCreatedTabRef.current = { supplierKey: key, poId: officeBlock.id };
              showPoCreatedFollowUpToast(officeBlock, entry, key);
            }
          }
          router.refresh();
          return { ok: true };
        }
        const body = await res.json().catch(() => null);
        console.error('Create PO failed:', body?.error ?? res.statusText);
        if (res.status === 409 && body?.code === 'PO_NUMBER_TAKEN') return { ok: false, reason: 'duplicate_po_number' };
        if (body?.error) toast.error(String(body.error));
        return { ok: false, reason: 'unknown' };
      } catch (err) {
        console.error('Create PO error:', err);
        return { ok: false, reason: 'unknown' };
      }
    },
    [states, setStates, patchedViewDataMap, draftInclusions, draftLineNotes, effectivePoNumberRef,
     router, activeStatusTab, showArchived, actions, pendingPoNavigationRef, pendingNewPoForPoCreatedTabRef,
     setActivePeriod, setActiveStatusTab, setMainPanel, setSelectedPoBlockId, setShowArchived, showPoCreatedFollowUpToast],
  );

  const handleSeparatePo = useCallback(
    async (payload: SeparatePoPayload) => {
      const entry = states[activeKey];
      if (!entry) return;

      const supplierId = resolveSupplierIdFromKey(activeKey);
      const raw = patchedViewDataMap[activeKey];
      const entryLocal = states[activeKey] ?? null;
      const drafts = entryLocal?.poCreated && raw?.type === 'pre'
        ? raw.shopifyOrderDrafts
        : raw?.type === 'pre' ? raw.shopifyOrderDrafts : (raw?.shopifyOrderDrafts ?? []);
      const openDrafts = showArchived ? drafts : drafts.filter((d) => !d.archivedAt);
      const draftPool = activeStatusTab === 'without_po'
        ? filterInboxDraftsForDisplay(openDrafts, raw?.type === 'post' ? raw.purchaseOrders : undefined)
        : openDrafts;
      const targetNorm = payload.shopifyOrderNumber.replace(/^#/, '').trim();
      const matchedDraft = draftPool.find((d) => d.orderNumber.replace(/^#/, '').trim() === targetNorm);

      try {
        const res = await fetch('/api/order/purchase-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            poNumber: payload.poNumber.trim() ? payload.poNumber.trim() : 'AUTO',
            supplierId,
            currency: 'CAD',
            expectedDate: payload.expectedDate,
            comment: payload.comment,
            lineItems: payload.lineItems.map((li) => ({
              sku: li.sku, productTitle: li.productTitle, variantTitle: li.variantTitle ?? null,
              quantity: li.quantity, itemPrice: li.itemPrice, supplierRef: supplierRefFromSku(li.sku),
              isCustom: li.isCustom ?? false, shopifyLineItemId: li.shopifyLineItemId ?? null,
              shopifyLineItemGid: li.shopifyLineItemGid ?? null, shopifyVariantGid: li.shopifyVariantGid ?? null,
              shopifyProductGid: li.shopifyProductGid ?? null, note: li.note != null ? String(li.note).trim() : '',
            })),
            shopifyOrderRefs: [{ orderNumber: payload.shopifyOrderNumber }],
            shippingAddress: payload.shippingAddress ?? undefined,
            billingSameAsShipping: true,
            deliveryLocationPresetId: payload.deliveryLocationPresetId ?? undefined,
          }),
        });

        if (res.ok) {
          const body = (await res.json().catch(() => null)) as { officeBlock?: OfficePurchaseOrderBlock } | null;
          const officeBlock = body?.officeBlock?.id ? body.officeBlock : null;
          if (officeBlock) {
            const removedDraftIds = matchedDraft ? [matchedDraft.id] : [];
            pendingNewPoForPoCreatedTabRef.current = { supplierKey: activeKey, poId: officeBlock.id };
            setStates((prev) => {
              const e = prev[activeKey];
              if (!e) return prev;
              return {
                ...prev,
                [activeKey]: patchSupplierEntryAfterPoCreate({
                  entry: e, newBlock: officeBlock, removedDraftIds: new Set(removedDraftIds),
                  removedDrafts: matchedDraft ? [matchedDraft] : [],
                }),
              };
            });
            actions.applyPoCreate(activeKey, officeBlock, removedDraftIds, () => {});
            setSelectedPoBlockId(officeBlock.id);
            showPoCreatedFollowUpToast(officeBlock, entry, activeKey);
          }
          router.refresh();
          return;
        }
        const body = await res.json().catch(() => null);
        console.error('Separate PO failed:', body?.error ?? res.statusText);
        if (res.status === 409 && body?.code === 'PO_NUMBER_TAKEN') {
          toast.error('This PO number is already in use. Change the PO number in the dialog and try again.');
        } else if (body?.error) {
          toast.error(String(body.error));
        }
      } catch (err) {
        console.error('Separate PO error:', err);
      }
    },
    [states, setStates, activeKey, router, patchedViewDataMap, activeStatusTab, showArchived,
     actions, pendingNewPoForPoCreatedTabRef, setSelectedPoBlockId, showPoCreatedFollowUpToast],
  );

  const handleEditPo = useCallback(
    async (poId: string, fields: EditPoFields): Promise<{ ok: true } | { ok: false; reason: 'duplicate_po_number' | 'unknown' }> => {
      const definedFieldKeys = (Object.keys(fields) as (keyof EditPoFields)[]).filter((k) => fields[k] !== undefined);
      const isHubStatusOnlyPut = definedFieldKeys.length === 1 && definedFieldKeys[0] === 'status' && fields.status != null;
      const nextHubStatus = isHubStatusOnlyPut ? fields.status! : null;

      if (isHubStatusOnlyPut && nextHubStatus) actions.setPoHubStatus(poId, nextHubStatus);
      const panelPatch = isHubStatusOnlyPut ? null : actions.applyPanelEdit(poId, fields);

      try {
        const res = await fetch(`/api/order/purchase-orders/${poId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        });
        const body = await res.json().catch(() => null);

        if (res.ok) {
          if (isHubStatusOnlyPut && nextHubStatus) {
            toast.success(nextHubStatus === 'pending' ? 'PO marked as pending' : 'PO pending cleared');
            if (nextHubStatus === 'pending') {
              const supplierKey = findSupplierKeyForPurchaseOrderId(patchedViewDataMap, poId);
              if (supplierKey) pendingPoNavigationRef.current = { supplierKey, poId };
              setActiveStatusTab((tab) =>
                tab === 'without_po' || tab === 'inbox' || tab === 'po_created' ? 'po_pending' : tab,
              );
              setActivePeriod('all');
            } else if (activeStatusTab === 'po_pending') {
              const currentVd = patchedViewDataMap[activeKey];
              const remainingPending = currentVd?.type === 'post'
                ? currentVd.purchaseOrders.filter((p) => p.id !== poId && p.id !== 'new' && !p.archivedAt && p.status === 'pending').length
                : 0;
              if (remainingPending === 0) setActiveStatusTab('po_created');
            }
          }
          router.refresh();
          return { ok: true };
        }

        if (isHubStatusOnlyPut) actions.clearPoHubStatus(poId);
        if (panelPatch) actions.rollbackPanelEdit(poId);

        console.error('Edit PO failed:', body?.error ?? res.statusText);
        if (res.status === 409 && body?.code === 'PO_NUMBER_TAKEN') return { ok: false, reason: 'duplicate_po_number' };
        if (isHubStatusOnlyPut) toast.error(typeof body?.error === 'string' ? body.error : 'Could not update PO status');
        else if (body?.error) toast.error(String(body.error));
        return { ok: false, reason: 'unknown' };
      } catch (err) {
        if (isHubStatusOnlyPut) { actions.clearPoHubStatus(poId); toast.error('Could not update PO status'); }
        if (panelPatch) actions.rollbackPanelEdit(poId);
        console.error('Edit PO error:', err);
        return { ok: false, reason: 'unknown' };
      }
    },
    [actions, router, patchedViewDataMap, activeStatusTab, activeKey, pendingPoNavigationRef, setActiveStatusTab, setActivePeriod],
  );

  const handleDeletePo = useCallback(
    async (poId: string) => {
      let supplierKey: SupplierKey | null = null;
      let deleted: OfficePurchaseOrderBlock | undefined;
      let entrySnapshot: SupplierEntry | undefined;

      for (const [key, vd] of Object.entries(patchedViewDataMap)) {
        if (vd.type !== 'post') continue;
        const b = vd.purchaseOrders.find((p) => p.id === poId);
        if (b) { supplierKey = key; deleted = b; entrySnapshot = states[key] ? { ...states[key as SupplierKey] } : undefined; break; }
      }

      const remainingReal = (() => {
        if (!supplierKey) return [] as OfficePurchaseOrderBlock[];
        const vd = patchedViewDataMap[supplierKey];
        if (!vd || vd.type !== 'post') return [];
        return vd.purchaseOrders.filter((p) => p.id !== poId && p.id !== 'new');
      })();

      actions.applyPoDelete(poId, supplierKey, deleted, remainingReal, setStates);
      setSelectedPoBlockId((sel) => (sel === poId ? null : sel));

      try {
        const res = await fetch(`/api/order/purchase-orders/${poId}`, { method: 'DELETE' });
        if (res.ok) { router.refresh(); return; }
        actions.rollbackPoDelete(poId, supplierKey, entrySnapshot, setStates);
        const body = await res.json().catch(() => null);
        console.error('Delete PO failed:', body?.error ?? res.statusText);
      } catch (err) {
        actions.rollbackPoDelete(poId, supplierKey, entrySnapshot, setStates);
        console.error('Delete PO error:', err);
      }
    },
    [patchedViewDataMap, states, setStates, actions, setSelectedPoBlockId, router],
  );

  const handleUnarchive = useCallback(
    async (key: SupplierKey) => {
      const e = states[key];
      if (!e) return;
      const snapshot = { ...e };
      const shopifyIds = [...e.archiveShopifyOrderIds];

      actions.unarchiveDraft(shopifyIds);
      const vd = viewDataMap[key];
      const draftRestoreCount = vd?.type === 'pre' ? vd.shopifyOrderDrafts.length : (vd?.shopifyOrderDrafts?.length ?? 0);
      setStates((prev) => ({
        ...prev,
        [key]: { ...prev[key], isArchived: false, ...(draftRestoreCount > 0 ? { withoutPoDraftCount: draftRestoreCount } : {}) },
      }));

      try {
        const res = await fetch('/api/order/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purchaseOrderIds: e.archivePurchaseOrderIds.length > 0 ? e.archivePurchaseOrderIds : undefined,
            shopifyOrderIds: e.archiveShopifyOrderIds.length > 0 ? e.archiveShopifyOrderIds : undefined,
            archive: false,
          }),
        });
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        router.refresh();
      } catch (err) {
        setStates((prev) => ({ ...prev, [key]: snapshot }));
        actions.removeDraftFromArchived(shopifyIds);
        console.error('Unarchive error:', err);
      }
    },
    [states, setStates, viewDataMap, actions, router],
  );

  const handleArchiveSupplierRow = useCallback(
    async (key: SupplierKey) => {
      const e = states[key];
      if (!e) return;
      const confirmed = window.confirm('Archive this supplier row? Linked Shopify orders and POs are hidden until you turn on "Show archived".');
      if (!confirmed) return;

      const snapshot = { ...e };
      const shopifyIds = [...e.archiveShopifyOrderIds];

      for (const id of shopifyIds) actions.archiveDraft(id);
      setStates((prev) => ({ ...prev, [key]: { ...prev[key], isArchived: true, withoutPoDraftCount: 0 } }));

      try {
        const res = await fetch('/api/order/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purchaseOrderIds: e.archivePurchaseOrderIds.length > 0 ? e.archivePurchaseOrderIds : undefined,
            shopifyOrderIds: shopifyIds.length > 0 ? shopifyIds : undefined,
            archive: true,
          }),
        });
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        router.refresh();
      } catch (err) {
        setStates((prev) => ({ ...prev, [key]: snapshot }));
        actions.removeDraftFromArchived(shopifyIds);
        console.error('Archive supplier row error:', err);
        toast.error('Could not archive');
      }
    },
    [states, setStates, actions, router],
  );

  const handleArchivePurchaseOrder = useCallback(
    async (poId: string) => {
      if (!poId || poId === '__drafts__' || poId === 'new') return;
      const confirmed = window.confirm('Archive this PO? It is hidden from open lists until you show archived items.');
      if (!confirmed) return;
      try {
        const res = await fetch('/api/order/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purchaseOrderIds: [poId], archive: true }),
        });
        if (!res.ok) { toast.error('Could not archive PO'); return; }
        setSelectedPoBlockId((sel) => (sel === poId ? null : sel));
        router.refresh();
      } catch (err) {
        console.error('Archive PO error:', err);
        toast.error('Could not archive PO');
      }
    },
    [setSelectedPoBlockId, router],
  );

  const handleUnarchiveShopifyOrder = useCallback(
    async (shopifyOrderDbId: string) => {
      const key = activeKey;
      const entryBefore = states[key];

      actions.unarchiveDraft([shopifyOrderDbId]);
      if (entryBefore) {
        setStates((prev) => {
          const e = prev[key];
          if (!e) return prev;
          return { ...prev, [key]: { ...e, withoutPoDraftCount: e.withoutPoDraftCount + 1, ...(!e.poCreated ? { isArchived: false } : {}) } };
        });
      }

      try {
        const res = await fetch('/api/order/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shopifyOrderIds: [shopifyOrderDbId], archive: false }),
        });
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        router.refresh();
      } catch (err) {
        actions.removeDraftFromArchived([shopifyOrderDbId]);
        if (entryBefore) setStates((prev) => ({ ...prev, [key]: { ...entryBefore } }));
        console.error('Unarchive Shopify order error:', err);
      }
    },
    [activeKey, states, setStates, actions, router],
  );

  const handleDeleteReplacementOrder = useCallback(async () => {
    const draft = currentDraftsRef.current.find((d) => d.isReplacementOrder);
    if (!draft) return;
    const res = await fetch(`/api/order/replacement-orders/${draft.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(body.error ?? 'Failed to delete replacement order');
      return;
    }
    toast.success('Replacement order deleted');
    router.refresh();
  }, [currentDraftsRef, router]);

  const handleAlertStripNavigate = useCallback(
    (it: { supplierKey: SupplierKey; purchaseOrderId: string; selectedPoPanelMeta?: PoPanelMeta | null }) => {
      const entry = states[it.supplierKey];
      if (!entry) return;
      setMainPanel('grouped');
      pendingPoNavigationRef.current = { supplierKey: it.supplierKey, poId: it.purchaseOrderId };
      setShowArchived(false);
      setActivePeriod('all');
    },
    [states, pendingPoNavigationRef, setMainPanel, setShowArchived, setActivePeriod],
  );

  const handleOfficePendingOrderStripNavigate = useCallback(
    (it: { supplierKey: SupplierKey; purchaseOrderId: string }) => {
      setMainPanel('grouped');
      setShowArchived(false);
      setActivePeriod('all');
      setActiveStatusTab('po_pending');
      pendingPoNavigationRef.current = { supplierKey: it.supplierKey, poId: it.purchaseOrderId };
    },
    [pendingPoNavigationRef, setActiveStatusTab, setActivePeriod, setMainPanel, setShowArchived],
  );

  return {
    handleOptimisticPoEmailSent,
    handleReplyReceivedChange,
    handleRetryLineItemFetch,
    handlePoEmailDeliveryWaivedChange,
    showPoCreatedFollowUpToast,
    handleCreatePo,
    handleSeparatePo,
    handleEditPo,
    handleDeletePo,
    handleUnarchive,
    handleArchiveSupplierRow,
    handleArchivePurchaseOrder,
    handleUnarchiveShopifyOrder,
    handleDeleteReplacementOrder,
    handleAlertStripNavigate,
    handleOfficePendingOrderStripNavigate,
  };
}
