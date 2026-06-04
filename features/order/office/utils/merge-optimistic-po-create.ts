import type {
  OfficePurchaseOrderBlock,
  PostViewData,
  PreViewData,
  SupplierEntry,
  SupplierKey,
  ViewData,
} from '../types';
import { isOfficePoDeliveryDone } from './po-fulfillment-for-tab';

function clonePoBlock(b: OfficePurchaseOrderBlock): OfficePurchaseOrderBlock {
  return {
    ...b,
    lineItems: b.lineItems.map((li) => ({ ...li })),
    panelMeta: b.panelMeta
      ? {
          ...b.panelMeta,
          linkedShopifyOrders: b.panelMeta.linkedShopifyOrders.map((o) => ({
            ...o,
          })),
        }
      : undefined,
  };
}

function decoratePostViewMultiPo(
  blocks: OfficePurchaseOrderBlock[],
  supplierName: string,
): Omit<PostViewData, 'shopifyOrderDrafts'> {
  const cloned = blocks.map(clonePoBlock);
  const isMulti = cloned.length > 1;
  if (isMulti) {
    for (const b of cloned) {
      b.subtreeRowLabel = `PO #${b.poNumber}${b.isAuto ? '' : ' — custom'}`;
    }
  } else {
    for (const b of cloned) {
      delete b.subtreeRowLabel;
    }
  }
  return {
    type: 'post',
    purchaseOrders: cloned,
    ...(isMulti && {
      subtreeParentLabel: `${supplierName} · ${cloned.length} POs`,
      multiPoSubtree: true,
    }),
  };
}

/**
 * Merges server `viewData` with a PO that was just created locally so the office
 * inbox updates immediately before `router.refresh()` finishes.
 */
export function mergeViewDataWithOptimisticPoCreates(
  viewDataMap: Record<SupplierKey, ViewData>,
  patches: Readonly<
    Partial<Record<SupplierKey, { newBlock: OfficePurchaseOrderBlock; removedDraftIds: ReadonlySet<string> } | undefined>>
  >,
  supplierNameByKey: Readonly<Record<SupplierKey, string>>,
): Record<SupplierKey, ViewData> {
  let any = false;
  const out: Record<SupplierKey, ViewData> = { ...viewDataMap };

  for (const key of Object.keys(viewDataMap)) {
    const patch = patches[key];
    if (!patch) continue;

    const vd = viewDataMap[key];
    if (!vd) continue;

    const drafts =
      vd.type === 'pre'
        ? vd.shopifyOrderDrafts
        : (vd.shopifyOrderDrafts ?? []);

    const nextDrafts = drafts.filter((d) => !patch.removedDraftIds.has(d.id));

    const existingPos =
      vd.type === 'post' ? vd.purchaseOrders.filter((p) => p.id !== 'new') : [];

    if (existingPos.some((p) => p.id === patch.newBlock.id)) {
      continue;
    }

    const mergedPos = [clonePoBlock(patch.newBlock), ...existingPos.map(clonePoBlock)];
    const supplierName = supplierNameByKey[key] ?? 'Supplier';

    const preserveLabels =
      vd.type === 'post'
        ? { label: vd.label, extraLabel: vd.extraLabel }
        : {};

    const basePost = decoratePostViewMultiPo(mergedPos, supplierName);
    const next: PostViewData = {
      ...preserveLabels,
      ...basePost,
      ...(nextDrafts.length > 0 ? { shopifyOrderDrafts: nextDrafts } : {}),
    };

    any = true;
    out[key] = next;
  }

  return any ? out : viewDataMap;
}

/** Bumps sidebar/meta counters after a successful PO create. */
export function patchSupplierEntryAfterPoCreate(args: {
  entry: SupplierEntry;
  newBlock: OfficePurchaseOrderBlock;
  removedDraftIds: ReadonlySet<string>;
  removedDrafts: ReadonlyArray<{ id: string; archivedAt?: string | null }>;
}): SupplierEntry {
  const { entry, newBlock, removedDraftIds, removedDrafts } = args;
  const m = newBlock.panelMeta;
  if (!m) return { ...entry, poCreated: true };

  const removedOpenDraftCount = removedDrafts.filter(
    (d) => removedDraftIds.has(d.id) && !d.archivedAt,
  ).length;

  const nextDraftCount = Math.max(0, entry.withoutPoDraftCount - removedOpenDraftCount);
  const nextArchivePoIds = entry.archivePurchaseOrderIds.includes(newBlock.id)
    ? entry.archivePurchaseOrderIds
    : [...entry.archivePurchaseOrderIds, newBlock.id];

  const fulfillDone = entry.fulfillDoneCount + m.fulfillDoneCount;
  const fulfillTotal = entry.fulfillTotalCount + m.fulfillTotalCount;
  const fulfillPending = fulfillTotal - fulfillDone;

  const expectedDatesSet = new Set(entry.expectedDates);
  if (m.expectedDate) expectedDatesSet.add(m.expectedDate);
  const expectedDates = [...expectedDatesSet].sort();

  const nextReferenceKey = entry.referenceKey.includes('without-po')
    ? newBlock.poNumber
    : `${entry.referenceKey}+${newBlock.poNumber}`;

  const allFulfilled = fulfillTotal > 0 && fulfillPending === 0;

  return {
    ...entry,
    poCreated: true,
    withoutPoDraftCount: nextDraftCount,
    archivePurchaseOrderIds: nextArchivePoIds,
    fulfillDoneCount: fulfillDone,
    fulfillPendingCount: fulfillPending,
    fulfillTotalCount: fulfillTotal,
    expectedDates,
    referenceKey: nextReferenceKey,
    emailSent:
      entry.supplierOrderChannelType !== 'email'
        ? entry.emailSent
        : entry.emailSent && !newBlock.emailDeliveryOutstanding,
    allFulfilled,
    allCompleted: false,
  };
}

/**
 * Replaces a target PO block with the server-returned block (after inbox lines were
 * merged in) and drops the merged drafts from that supplier slice — so the Inbox and
 * the PO update immediately before `router.refresh()` lands.
 */
export function mergeViewDataWithOptimisticPoMerges(
  viewDataMap: Record<SupplierKey, ViewData>,
  merges: Readonly<
    Partial<
      Record<
        SupplierKey,
        { poId: string; updatedBlock: OfficePurchaseOrderBlock; removedDraftIds: ReadonlySet<string> } | undefined
      >
    >
  >,
  supplierNameByKey: Readonly<Record<SupplierKey, string>>,
): Record<SupplierKey, ViewData> {
  let any = false;
  const out: Record<SupplierKey, ViewData> = { ...viewDataMap };

  for (const key of Object.keys(viewDataMap)) {
    const merge = merges[key];
    if (!merge) continue;

    const vd = viewDataMap[key];
    if (!vd || vd.type !== 'post') continue;
    if (!vd.purchaseOrders.some((p) => p.id === merge.poId)) continue;

    const nextPos = vd.purchaseOrders.map((p) =>
      p.id === merge.poId ? clonePoBlock(merge.updatedBlock) : p,
    );

    const drafts = vd.shopifyOrderDrafts ?? [];
    const nextDrafts = drafts.filter((d) => !merge.removedDraftIds.has(d.id));

    const supplierName = supplierNameByKey[key] ?? 'Supplier';
    const preserveLabels = { label: vd.label, extraLabel: vd.extraLabel };
    const basePost = decoratePostViewMultiPo(nextPos, supplierName);
    const next: PostViewData = {
      ...preserveLabels,
      ...basePost,
      ...(nextDrafts.length > 0 ? { shopifyOrderDrafts: nextDrafts } : {}),
    };

    any = true;
    out[key] = next;
  }

  return any ? out : viewDataMap;
}

/** Bumps sidebar/meta counters after a successful inbox→existing-PO merge. */
export function patchSupplierEntryAfterPoMerge(args: {
  entry: SupplierEntry;
  oldBlock: OfficePurchaseOrderBlock | undefined;
  newBlock: OfficePurchaseOrderBlock;
  removedDraftIds: ReadonlySet<string>;
  removedDrafts: ReadonlyArray<{ id: string; archivedAt?: string | null }>;
}): SupplierEntry {
  const { entry, oldBlock, newBlock, removedDraftIds, removedDrafts } = args;

  const removedOpenDraftCount = removedDrafts.filter(
    (d) => removedDraftIds.has(d.id) && !d.archivedAt,
  ).length;
  const nextDraftCount = Math.max(0, entry.withoutPoDraftCount - removedOpenDraftCount);

  const oldM = oldBlock?.panelMeta;
  const newM = newBlock.panelMeta;
  const doneDelta = (newM?.fulfillDoneCount ?? 0) - (oldM?.fulfillDoneCount ?? 0);
  const totalDelta = (newM?.fulfillTotalCount ?? 0) - (oldM?.fulfillTotalCount ?? 0);

  const fulfillDone = Math.max(0, entry.fulfillDoneCount + doneDelta);
  const fulfillTotal = Math.max(0, entry.fulfillTotalCount + totalDelta);
  const fulfillPending = Math.max(0, fulfillTotal - fulfillDone);
  const allFulfilled = fulfillTotal > 0 && fulfillPending === 0;

  return {
    ...entry,
    poCreated: true,
    withoutPoDraftCount: nextDraftCount,
    fulfillDoneCount: fulfillDone,
    fulfillPendingCount: fulfillPending,
    fulfillTotalCount: fulfillTotal,
    allFulfilled,
    allCompleted: false,
  };
}

/**
 * Removes PO rows that were optimistically deleted before `router.refresh()` lands.
 */
export function mergeViewDataWithOptimisticPoDeletes(
  viewDataMap: Record<SupplierKey, ViewData>,
  deletedIds: ReadonlySet<string>,
  supplierNameByKey: Readonly<Record<SupplierKey, string>>,
): Record<SupplierKey, ViewData> {
  if (deletedIds.size === 0) return viewDataMap;

  let any = false;
  const out: Record<SupplierKey, ViewData> = { ...viewDataMap };

  for (const key of Object.keys(viewDataMap)) {
    const vd = viewDataMap[key];
    if (vd.type !== 'post') continue;

    const nextPos = vd.purchaseOrders.filter((p) => !deletedIds.has(p.id));
    if (nextPos.length === vd.purchaseOrders.length) continue;

    const supplierName = supplierNameByKey[key] ?? 'Supplier';
    const preserveLabels =
      vd.label != null || vd.extraLabel != null
        ? { label: vd.label, extraLabel: vd.extraLabel }
        : {};
    const drafts = vd.shopifyOrderDrafts;

    if (nextPos.length === 0) {
      const nextPre: PreViewData = {
        type: 'pre',
        shopifyOrderDrafts: drafts ?? [],
      };
      any = true;
      out[key] = nextPre;
      continue;
    }

    const basePost = decoratePostViewMultiPo(nextPos, supplierName);
    const next: PostViewData = {
      ...preserveLabels,
      ...basePost,
      ...(drafts && drafts.length > 0 ? { shopifyOrderDrafts: drafts } : {}),
    };
    any = true;
    out[key] = next;
  }

  return any ? out : viewDataMap;
}

/** Bumps sidebar/meta counters after a successful PO delete (approximate until refresh). */
export function patchSupplierEntryAfterPoDelete(args: {
  entry: SupplierEntry;
  deleted: OfficePurchaseOrderBlock;
  /** Real PO rows left for this supplier slice (`id !== 'new'`). */
  remainingPoBlocks: OfficePurchaseOrderBlock[];
}): SupplierEntry {
  const { entry, deleted, remainingPoBlocks } = args;
  const realRemaining = remainingPoBlocks.filter((p) => p.id !== 'new');
  const m = deleted.panelMeta;

  const nextArchivePoIds = entry.archivePurchaseOrderIds.filter(
    (id) => id !== deleted.id,
  );

  const restoredDrafts = deleted.shopifyOrderCount;
  const nextDraftCount = entry.withoutPoDraftCount + restoredDrafts;

  let fulfillDone = entry.fulfillDoneCount;
  let fulfillTotal = entry.fulfillTotalCount;
  if (m) {
    fulfillDone = Math.max(0, fulfillDone - m.fulfillDoneCount);
    fulfillTotal = Math.max(0, fulfillTotal - m.fulfillTotalCount);
  }
  const fulfillPending = fulfillTotal - fulfillDone;

  const expectedDatesAll = realRemaining
    .map((b) => b.panelMeta?.expectedDate ?? null)
    .filter((d): d is string => d != null && d !== '');
  const expectedDates = [...new Set(expectedDatesAll)].sort();

  const referenceKey =
    realRemaining.length > 0
      ? realRemaining.map((b) => b.poNumber).join('+')
      : entry.referenceKey;

  const allFulfilled =
    realRemaining.length > 0 &&
    realRemaining.every((b) => isOfficePoDeliveryDone(b));
  const allCompleted =
    allFulfilled &&
    realRemaining.length > 0 &&
    realRemaining.every((b) => b.status === 'completed');

  const anyOutstanding =
    entry.supplierOrderChannelType === 'email' &&
    realRemaining.some((b) => b.emailDeliveryOutstanding);

  return {
    ...entry,
    poCreated: realRemaining.length > 0,
    withoutPoDraftCount: nextDraftCount,
    archivePurchaseOrderIds: nextArchivePoIds,
    fulfillDoneCount: fulfillDone,
    fulfillPendingCount: fulfillPending,
    fulfillTotalCount: fulfillTotal,
    expectedDates,
    referenceKey,
    emailSent:
      entry.supplierOrderChannelType !== 'email'
        ? entry.emailSent
        : realRemaining.length > 0
          ? !anyOutstanding
          : false,
    allFulfilled,
    allCompleted,
  };
}
