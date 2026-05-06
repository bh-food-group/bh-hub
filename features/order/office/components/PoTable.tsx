'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import { formatShopifyOrderDisplayFulfillmentStatus } from '@/types/shopify';
import {
  formatProductLabel,
  type LineFulfillmentStatus,
  type OfficePurchaseOrderBlock,
  type PoLineItemView,
  type PurchaseOrderStatus,
} from '../types';
import type { EditPoFields, EditPoResult } from './MetaPanel';
import { formatItemPrice } from '../mappers/map-purchase-order';
import type { ShopifyOrderEditOperation } from '@/lib/api/schemas';
import {
  ShopifyProductSearchPanel,
  type ShopifyProductSearchHit,
} from '@/components/shopify';
import {
  ShopifyLineProductCell,
  ShopifyProductAdminArrowLink,
} from './ShopifyLineProductCell';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CreateReplacementOrderDialog } from './CreateReplacementOrderDialog';
import { RefundCreateDialog } from './RefundCreateDialog';
import { QtyField } from './QtyField';

type Props = {
  shopifyAdminStoreHandle?: string | null;
  purchaseOrder: OfficePurchaseOrderBlock;
  lineItemsLoading?: boolean;
  onRetryLineItems?: () => void;
  /** Toggle hub PO pending (same as meta panel) — shown on the PO table header. */
  onEditPo?: (poId: string, fields: EditPoFields) => Promise<EditPoResult>;
  /** Inbox customer key segment for split PO # defaults when order snapshot omits account code. */
  inboxCustomerPoSegment?: string;
};

const badgeCompact = 'rounded px-1.5 text-[10px]';

const RECV_TONE_RED: LineFulfillmentStatus[] = [
  'UNFULFILLED',
  'OPEN',
  'RESTOCKED',
  'REQUEST_DECLINED',
];

function recvCellTone(status: LineFulfillmentStatus): string {
  if (status === 'FULFILLED') return 'text-[#27500A]';
  if (RECV_TONE_RED.includes(status)) return 'text-[#A32D2D]';
  return 'text-[#BA7517]';
}

function StatusBadge({ status }: { status: LineFulfillmentStatus }) {
  const label = formatShopifyOrderDisplayFulfillmentStatus(status);
  if (status === 'FULFILLED') {
    return (
      <Badge variant="green" className={badgeCompact}>
        {label}
      </Badge>
    );
  }
  if (RECV_TONE_RED.includes(status)) {
    return (
      <Badge variant="red" className={badgeCompact}>
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="amber" className={badgeCompact}>
      {label}
    </Badge>
  );
}

// ─── Icon: checklist (signals "enter selection mode") ─────────────────────────

function ChecklistIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

type EditPoLine = PoLineItemView & {
  _local: string;
  _removed?: boolean;
  _isNew?: boolean;
  _newKind?: 'variant';
};

function parseMoney(s: string | null | undefined): number {
  if (s == null || s === '') return 0;
  const n = parseFloat(String(s).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(amount: number, currency = 'CAD'): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function poLocalKey(): string {
  return `p_${Math.random().toString(36).slice(2, 11)}`;
}

// ─── Main component ────────────────────────────────────────────────────────────

function nextFulfillmentStatus(
  qty: number,
  quantityReceived: number,
): LineFulfillmentStatus {
  if (qty <= 0) return 'FULFILLED';
  if (quantityReceived >= qty) return 'FULFILLED';
  if (quantityReceived > 0) return 'PARTIALLY_FULFILLED';
  return 'UNFULFILLED';
}

export function PoTable({
  shopifyAdminStoreHandle,
  purchaseOrder,
  lineItemsLoading,
  onRetryLineItems,
  onEditPo,
  inboxCustomerPoSegment: _inboxCustomerPoSegment,
}: Props) {
  const router = useRouter();
  const [pendingStatusSaving, setPendingStatusSaving] = useState(false);
  const [optimisticLineItems, setOptimisticLineItems] = useState<
    PoLineItemView[] | null
  >(null);

  useEffect(() => {
    setOptimisticLineItems(null);
  }, [purchaseOrder.id]);

  // Clear optimistic state when server data arrives with updated quantities
  useEffect(() => {
    setOptimisticLineItems(null);
  }, [purchaseOrder.lineItems]);

  useEffect(() => {
    setNoteEditingId(null);
    setNoteDraft('');
  }, [purchaseOrder.id]);

  const items = optimisticLineItems ?? purchaseOrder.lineItems;

  const fulfilled = items.filter(
    (i) => i.fulfillmentStatus === 'FULFILLED',
  ).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((fulfilled / total) * 100) : 0;
  const allFulfilled = fulfilled === total && total > 0;
  const noneFulfilled = fulfilled === 0;

  // ── Fulfill mode state ────────────────────────────────────────────────────
  const [fulfillMode, setFulfillMode] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [recvValues, setRecvValues] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [orderEditMode, setOrderEditMode] = useState(false);
  const [editLines, setEditLines] = useState<EditPoLine[]>([]);
  const [origByGid, setOrigByGid] = useState<
    Map<string, { qty: number; price: string | null }>
  >(() => new Map());
  const linkedOrders = useMemo(
    () => purchaseOrder.panelMeta?.linkedShopifyOrders ?? [],
    [purchaseOrder.panelMeta],
  );
  const defaultTargetOrderId = linkedOrders[0]?.id ?? '';
  const [newLineTargetOrderId, setNewLineTargetOrderId] = useState(
    () => defaultTargetOrderId,
  );
  const [savingOrderEdit, setSavingOrderEdit] = useState(false);
  const [orderEditError, setOrderEditError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  const [refundDialogOpen, setRefundDialogOpen] = useState(false);

  // ── Custom order selection ────────────────────────────────────────────────
  const [replacementSelectMode, setReplacementSelectMode] = useState(false);
  const [selectedForReplacement, setSelectedForReplacement] = useState<Set<string>>(new Set());
  const [replacementQtyOverrides, setReplacementQtyOverrides] = useState<Record<string, number>>({});
  const [replacementOrderDialogOpen, setReplacementOrderDialogOpen] = useState(false);

  const enterReplacementSelectMode = useCallback(() => {
    setSelectedForReplacement(new Set());
    setReplacementQtyOverrides({});
    setReplacementSelectMode(true);
  }, []);

  const exitReplacementSelectMode = useCallback(() => {
    setReplacementSelectMode(false);
    setSelectedForReplacement(new Set());
    setReplacementQtyOverrides({});
  }, []);

  const toggleReplacementSelect = useCallback((id: string) => {
    setSelectedForReplacement((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedItemsForReplacement = useMemo(
    () => items.filter((i) => selectedForReplacement.has(i.id)),
    [items, selectedForReplacement],
  );

  const referenceOrderNames = useMemo(
    () =>
      purchaseOrder.panelMeta?.linkedShopifyOrders
        .map((o) => o.name)
        .join(', ') ?? null,
    [purchaseOrder.panelMeta],
  );

  const enterFulfillMode = useCallback(() => {
    const initChecked: Record<string, boolean> = {};
    const initRecv: Record<string, number> = {};
    for (const item of items) {
      initChecked[item.id] = item.fulfillmentStatus !== 'FULFILLED';
      initRecv[item.id] = item.quantity;
    }
    setChecked(initChecked);
    setRecvValues(initRecv);
    setSaveError(null);
    setOrderEditMode(false);
    setFulfillMode(true);
  }, [items]);

  const exitFulfillMode = useCallback(() => {
    setFulfillMode(false);
    setChecked({});
    setRecvValues({});
    setSaveError(null);
  }, []);

  const handleTogglePoHubPending = useCallback(() => {
    if (!onEditPo || purchaseOrder.id === 'new') return;
    const next: PurchaseOrderStatus =
      purchaseOrder.status === 'pending' ? 'unfulfilled' : 'pending';
    setPendingStatusSaving(true);
    void (async () => {
      try {
        await onEditPo(purchaseOrder.id, { status: next });
      } finally {
        setPendingStatusSaving(false);
      }
    })();
  }, [onEditPo, purchaseOrder.id, purchaseOrder.status]);

  const toggleItem = useCallback((id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const toggleAll = useCallback(() => {
    const allChecked = items.every((i) => checked[i.id]);
    const next: Record<string, boolean> = {};
    for (const item of items) next[item.id] = !allChecked;
    setChecked(next);
  }, [items, checked]);

  const setRecv = useCallback((id: string, value: number) => {
    setRecvValues((prev) => ({ ...prev, [id]: value }));
  }, []);

  const markAllReceived = useCallback(() => {
    const next: Record<string, number> = { ...recvValues };
    for (const item of items) {
      if (checked[item.id]) next[item.id] = item.quantity;
    }
    setRecvValues(next);
  }, [items, checked, recvValues]);

  const checkedCount = Object.values(checked).filter(Boolean).length;
  const allItemsChecked = items.length > 0 && items.every((i) => checked[i.id]);
  const someChecked = checkedCount > 0 && !allItemsChecked;

  const handleFulfill = useCallback(async () => {
    const sourceItems = optimisticLineItems ?? purchaseOrder.lineItems;
    const toSave = sourceItems
      .filter((i) => checked[i.id])
      .map((i) => ({
        id: i.id,
        quantityReceived: Math.max(0, recvValues[i.id] ?? i.quantityReceived),
      }));

    if (toSave.length === 0) return;

    const optimisticNext = sourceItems.map((i) => {
      if (!checked[i.id]) return i;
      const quantityReceived = Math.max(
        0,
        recvValues[i.id] ?? i.quantityReceived,
      );
      return {
        ...i,
        quantityReceived,
        fulfillmentStatus: nextFulfillmentStatus(i.quantity, quantityReceived),
      };
    });
    setOptimisticLineItems(optimisticNext);

    setSaving(true);
    setSaveError(null);

    try {
      const res = await fetch(
        `/api/order/purchase-orders/${purchaseOrder.id}/receive`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: toSave }),
        },
      );

      const body = (await res.json().catch(() => null)) as {
        error?: string;
        shopifyWarnings?: string[];
      } | null;

      if (!res.ok) {
        setOptimisticLineItems(null);
        setSaveError(body?.error ?? 'Failed to save fulfillment');
        toast.error(body?.error ?? 'Failed to save fulfillment');
        return;
      }

      const warnings = body?.shopifyWarnings;
      if (Array.isArray(warnings) && warnings.length > 0) {
        toast.warning('Saved in hub; Shopify fulfillment issue', {
          description: warnings.slice(0, 3).join(' · '),
        });
      } else {
        toast.success('Fulfillment saved');
      }

      exitFulfillMode();
      router.refresh();
    } catch {
      setOptimisticLineItems(null);
      setSaveError('Network error — please try again');
      toast.error('Network error — please try again');
    } finally {
      setSaving(false);
    }
  }, [
    purchaseOrder.lineItems,
    optimisticLineItems,
    checked,
    recvValues,
    purchaseOrder.id,
    exitFulfillMode,
    router,
  ]);

  const enterOrderEditMode = useCallback(() => {
    setFulfillMode(false);
    const m = new Map<string, { qty: number; price: string | null }>();
    for (const li of items) {
      if (li.shopifyLineItemGid) {
        m.set(li.shopifyLineItemGid, { qty: li.quantity, price: li.itemPrice });
      }
    }
    setOrigByGid(m);
    setEditLines(
      items.map((li) => ({
        ...li,
        _local: li.id,
      })),
    );
    setNewLineTargetOrderId(defaultTargetOrderId || linkedOrders[0]?.id || '');
    setOrderEditError(null);
    setOrderEditMode(true);
    // #region agent log
    {
      const withGid = items.filter((li) =>
        Boolean(li.shopifyLineItemGid),
      ).length;
      const unlinked = items.filter(
        (li) => !li.shopifyLineItemGid && !li.shopifyOrderLineItemId,
      ).length;
      const linkedNoGid = items.filter(
        (li) => Boolean(li.shopifyOrderLineItemId) && !li.shopifyLineItemGid,
      ).length;
      fetch(
        'http://127.0.0.1:7683/ingest/7f331419-eef8-4634-99ba-aa19be51640a',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': '70b2ce',
          },
          body: JSON.stringify({
            sessionId: '70b2ce',
            runId: 'pre-fix',
            hypothesisId: 'H1',
            location: 'PoTable.tsx:enterOrderEditMode',
            message: 'Edit order lines: line linkage vs editable gate',
            data: {
              poId: purchaseOrder.id,
              lineCount: items.length,
              withShopifyLineItemGid: withGid,
              unlinkedNoShopifyOrderLineItem: unlinked,
              linkedButMissingGid: linkedNoGid,
              rowsWithoutGidMatchPlainQtyUi: items.filter(
                (li) => !li.shopifyLineItemGid,
              ).length,
            },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
    }
    // #endregion
  }, [items, defaultTargetOrderId, linkedOrders, purchaseOrder.id]);

  const exitOrderEditMode = useCallback(() => {
    setOrderEditMode(false);
    setEditLines([]);
    setOrderEditError(null);
  }, []);

  const visibleEditLines = useMemo(
    () => editLines.filter((l) => !l._removed),
    [editLines],
  );

  const saveOrderEdits = useCallback(async () => {
    setSavingOrderEdit(true);
    setOrderEditError(null);
    try {
      const variantCatalogUpdates: {
        productGid: string;
        variantGid: string;
        price: string;
      }[] = [];
      const groups = new Map<string, ShopifyOrderEditOperation[]>();
      const ensure = (id: string) => {
        if (!groups.has(id)) groups.set(id, []);
        return groups.get(id)!;
      };

      const soleLinkedOrderId =
        linkedOrders.length === 1 ? linkedOrders[0].id : null;

      for (const [gid, o] of origByGid) {
        const row = editLines.find(
          (d) => d.shopifyLineItemGid === gid && !d._removed,
        );
        const orderLocalId =
          row?.shopifyOrderId ??
          items.find((i) => i.shopifyLineItemGid === gid)?.shopifyOrderId ??
          soleLinkedOrderId;
        if (!orderLocalId) continue;
        if (!row) {
          ensure(orderLocalId).push({
            type: 'setQuantity',
            shopifyLineItemGid: gid,
            quantity: 0,
            restock: false,
          });
          continue;
        }
        if (row.quantity !== o.qty) {
          ensure(orderLocalId).push({
            type: 'setQuantity',
            shopifyLineItemGid: gid,
            quantity: row.quantity,
            restock: false,
          });
        }
        const oldP = parseMoney(o.price);
        const newP = parseMoney(row.itemPrice);
        if (Math.abs(oldP - newP) > 0.0005) {
          if (row.shopifyVariantGid && row.shopifyProductGid) {
            const upd = window.confirm(
              'Also update the catalog variant price in Shopify for this line?',
            );
            if (upd) {
              variantCatalogUpdates.push({
                productGid: row.shopifyProductGid,
                variantGid: row.shopifyVariantGid,
                price: newP.toFixed(2),
              });
            }
          }
          ensure(orderLocalId).push({
            type: 'setUnitPrice',
            shopifyLineItemGid: gid,
            unitPrice: newP,
          });
        }
      }

      for (const row of editLines) {
        if (row._removed || row.shopifyLineItemGid) continue;
        const target = newLineTargetOrderId;
        if (!target) {
          setOrderEditError('Select a Shopify order for new lines.');
          return;
        }
        if (row._isNew && row._newKind === 'variant' && row.shopifyVariantGid) {
          const unit = parseMoney(row.itemPrice);
          if (row.shopifyProductGid && row.shopifyVariantGid) {
            const upd = window.confirm(
              'Also update the catalog variant price for this new line?',
            );
            if (upd) {
              variantCatalogUpdates.push({
                productGid: row.shopifyProductGid,
                variantGid: row.shopifyVariantGid,
                price: unit.toFixed(2),
              });
            }
          }
          ensure(target).push({
            type: 'addVariant',
            variantGid: row.shopifyVariantGid,
            quantity: Math.max(1, row.quantity),
            allowDuplicates: true,
            unitPriceOverride: unit > 0 ? unit : undefined,
          });
        }
      }

      const entries = [...groups.entries()].filter(([, ops]) => ops.length > 0);
      if (entries.length === 0) {
        toast.message('No Shopify changes to save');
        setOrderEditMode(false);
        return;
      }

      let hadAdds = false;
      for (const [, ops] of entries) {
        if (ops.some((o) => o.type === 'addVariant')) {
          hadAdds = true;
          break;
        }
      }

      let appendAfterSync: string | undefined;
      for (const [localOrderId, ops] of entries) {
        const addsHere = ops.some((o) => o.type === 'addVariant');
        if (hadAdds && addsHere && newLineTargetOrderId === localOrderId) {
          appendAfterSync = localOrderId;
          break;
        }
      }

      if (entries.length === 1) {
        const [localOrderId, ops] = entries[0];
        const addsHere = ops.some((o) => o.type === 'addVariant');
        const res = await fetch(
          `/api/shopify/orders/${localOrderId}/apply-edit`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operations: ops,
              variantCatalogUpdates:
                variantCatalogUpdates.length > 0
                  ? variantCatalogUpdates
                  : undefined,
              purchaseOrderId: purchaseOrder.id,
              appendLinesFromShopifyOrderLocalId:
                hadAdds && addsHere && newLineTargetOrderId === localOrderId
                  ? localOrderId
                  : undefined,
            }),
          },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setOrderEditError(
            typeof body?.error === 'string' ? body.error : 'Save failed',
          );
          return;
        }
      } else {
        const responses = await Promise.all(
          entries.map(([localOrderId, ops]) =>
            fetch(`/api/shopify/orders/${localOrderId}/apply-edit`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                operations: ops,
                purchaseOrderId: purchaseOrder.id,
                deferPurchaseOrderResync: true,
              }),
            }),
          ),
        );
        for (const res of responses) {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            setOrderEditError(
              typeof body?.error === 'string' ? body.error : 'Save failed',
            );
            return;
          }
        }
        if (variantCatalogUpdates.length > 0) {
          const vres = await fetch('/api/shopify/variant-catalog-updates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates: variantCatalogUpdates }),
          });
          const vbody = await vres.json().catch(() => ({}));
          if (!vres.ok) {
            setOrderEditError(
              typeof vbody?.error === 'string'
                ? vbody.error
                : 'Catalog price update failed',
            );
            return;
          }
        }
        const rres = await fetch(
          `/api/order/purchase-orders/${purchaseOrder.id}/resync-from-shopify`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              appendFromShopifyOrderLocalId: appendAfterSync,
            }),
          },
        );
        const rbody = await rres.json().catch(() => ({}));
        if (!rres.ok) {
          setOrderEditError(
            typeof rbody?.error === 'string' ? rbody.error : 'PO resync failed',
          );
          return;
        }
      }

      toast.success('Shopify order(s) updated');
      setOrderEditMode(false);
      router.refresh();
    } catch {
      setOrderEditError('Network error');
    } finally {
      setSavingOrderEdit(false);
    }
  }, [
    origByGid,
    editLines,
    items,
    linkedOrders,
    purchaseOrder.id,
    newLineTargetOrderId,
    router,
  ]);

  // ── Columns layout ─────────────────────────────────────────────────────────
  // Normal:   checkbox(0) | shopify# | product | ref | cost | qty | recv | status
  // Fulfill:  checkbox(5%) | shopify# | product | ref | cost | qty | recv | status

  const tableRows = orderEditMode ? visibleEditLines : items;
  const costSubtotal = useMemo(
    () =>
      tableRows.reduce((sum, item) => {
        return (
          sum +
          parseMoney(item.itemCost ?? null) * Math.max(0, item.quantity ?? 0)
        );
      }, 0),
    [tableRows],
  );

  const addSearchHitToPo = useCallback(
    (hit: ShopifyProductSearchHit) => {
      const key = poLocalKey();
      const ord = linkedOrders.find((o) => o.id === newLineTargetOrderId);
      setEditLines((prev) => [
        ...prev,
        {
          id: key,
          purchaseOrderId: purchaseOrder.id,
          sequence: prev.length + 1,
          quantity: 1,
          quantityReceived: 0,
          supplierRef: null,
          sku: hit.sku,
          variantTitle: hit.variantTitle ?? null,
          productTitle: hit.productTitle,
          imageUrl: hit.imageUrl ?? null,
          isCustom: false,
          itemPrice: hit.price ?? '0',
          shopifyOrderLineItemId: null,
          shopifyLineItemGid: null,
          shopifyVariantGid: hit.variantId,
          shopifyProductGid: hit.productId,
          shopifyOrderId: newLineTargetOrderId || null,
          shopifyOrderNumber: ord?.name ?? '—',
          fulfillmentStatus: 'UNFULFILLED' as LineFulfillmentStatus,
          note: null,
          _local: key,
          _isNew: true,
          _newKind: 'variant' as const,
        },
      ]);
      setAddOpen(false);
    },
    [linkedOrders, newLineTargetOrderId, purchaseOrder.id],
  );

  const lazyLineCount = purchaseOrder.panelMeta?.fulfillTotalCount ?? 0;
  if (items.length === 0 && lazyLineCount > 0) {
    return (
      <div className="bg-background border border-border rounded-[10px] overflow-hidden mb-2.5">
        <div className="flex items-center justify-between px-3.5 py-2 border-b bg-muted/40">
          <div className="text-[12px] font-medium">{purchaseOrder.title}</div>
          {onEditPo && purchaseOrder.id !== 'new' && (
            <Button
              type="button"
              variant={
                purchaseOrder.status === 'pending' ? 'default' : 'outline'
              }
              size="xs"
              className="text-[10px] rounded-[5px] shrink-0"
              disabled={pendingStatusSaving}
              onClick={() => void handleTogglePoHubPending()}
            >
              {pendingStatusSaving
                ? 'Saving…'
                : purchaseOrder.status === 'pending'
                  ? 'Clear pending'
                  : 'Mark PO pending'}
            </Button>
          )}
        </div>
        {lineItemsLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading items…
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-6">
            <p className="text-[12px] text-muted-foreground">
              Failed to load items.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1.5"
              onClick={() => onRetryLineItems?.()}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-background border border-border rounded-[10px] overflow-hidden mb-2.5">
      {/* ── Table header ── */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b bg-muted/40">
        <div className="text-[12px] font-medium flex items-center gap-2">
          {purchaseOrder.title}
          {purchaseOrder.shopifyOrderCount > 0 && (
            <span className="text-[10px] font-normal text-muted-foreground">
              · {purchaseOrder.shopifyOrderCount} Shopify order
              {purchaseOrder.shopifyOrderCount !== 1 ? 's' : ''} combined
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {orderEditMode ? (
            <>
              <Button
                variant="outline"
                size="xs"
                className="text-[10px] rounded-[5px]"
                onClick={exitOrderEditMode}
                disabled={savingOrderEdit}
              >
                Cancel
              </Button>
              <Button
                size="xs"
                className="text-[10px] rounded-[5px] gap-1"
                onClick={() => void saveOrderEdits()}
                disabled={savingOrderEdit}
              >
                {savingOrderEdit ? (
                  <>
                    <Loader2 className="size-3.5 shrink-0 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </>
          ) : (
            <>
              {onEditPo && purchaseOrder.id !== 'new' && (
                <Button
                  type="button"
                  variant={
                    purchaseOrder.status === 'pending' ? 'default' : 'outline'
                  }
                  size="xs"
                  className="text-[10px] rounded-[5px] shrink-0"
                  disabled={pendingStatusSaving || fulfillMode}
                  onClick={() => void handleTogglePoHubPending()}
                >
                  {pendingStatusSaving
                    ? 'Saving…'
                    : purchaseOrder.status === 'pending'
                      ? 'Clear pending'
                      : 'Mark PO pending'}
                </Button>
              )}
              <Button
                variant="outline"
                size="xs"
                className="text-[10px] rounded-[5px]"
                disabled={fulfillMode}
                onClick={enterOrderEditMode}
              >
                Edit order lines
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {saveError && (
        <div className="px-3.5 py-1.5 text-[11px] text-destructive bg-destructive/5 border-b">
          {saveError}
        </div>
      )}
      {orderEditError && (
        <div className="px-3.5 py-1.5 text-[11px] text-destructive bg-destructive/5 border-b">
          {orderEditError}
        </div>
      )}

      {orderEditMode && (
        <div className="px-3.5 py-2 border-b flex flex-wrap items-center gap-3 bg-muted/20 text-[11px]">
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground whitespace-nowrap">
              New lines attach to
            </span>
            <select
              className="border rounded px-2 py-1 text-[11px] bg-background"
              value={newLineTargetOrderId}
              onChange={(e) => setNewLineTargetOrderId(e.target.value)}
            >
              {linkedOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="text-[10px] rounded-[5px]"
            onClick={() => setAddOpen(true)}
          >
            Add line
          </Button>
        </div>
      )}

      {/* ── Progress bar + Fulfill controls ── */}
      <div className="flex items-center gap-2 px-3.5 py-[5px] text-[11px] text-muted-foreground border-b">
        <span>Fulfilled</span>
        <div className="flex-1 h-[3px] rounded bg-muted overflow-hidden">
          <div
            className="h-full rounded bg-[#639922] transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className={cn(
            'font-medium',
            allFulfilled
              ? 'text-[#27500A]'
              : noneFulfilled
                ? 'text-[#A32D2D]'
                : 'text-foreground',
          )}
        >
          {fulfilled} / {total} items
        </span>

        {/* Fulfill button / mode controls */}
        {fulfillMode ? (
          <div className="flex items-center gap-1 ml-1">
            {checkedCount > 0 && (
              <button
                type="button"
                onClick={markAllReceived}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Mark all received
              </button>
            )}
            <Button
              variant="outline"
              size="xs"
              className="text-[10px] rounded-[5px]"
              onClick={exitFulfillMode}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              className="text-[10px] rounded-[5px] gap-1"
              onClick={handleFulfill}
              disabled={saving || checkedCount === 0}
            >
              {saving ? (
                <>
                  <svg
                    className="animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                  Saving…
                </>
              ) : (
                <>
                  Fulfill
                  {checkedCount > 0 && (
                    <span className="opacity-75">({checkedCount})</span>
                  )}
                </>
              )}
            </Button>
          </div>
        ) : replacementSelectMode ? (
          <div className="flex items-center gap-1 ml-1">
            {purchaseOrder.replacementOrderCount > 0 && (
              <Badge variant="amber" className="rounded px-1.5 text-[10px]">
                Replacement: {purchaseOrder.replacementOrderCount}
              </Badge>
            )}
            <Button
              variant="outline"
              size="xs"
              className="text-[10px] rounded-[5px]"
              onClick={exitReplacementSelectMode}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              variant="outline"
              className="text-[10px] rounded-[5px] gap-1 border-amber-400 text-amber-700 hover:bg-amber-50"
              disabled={selectedForReplacement.size === 0}
              onClick={() => setReplacementOrderDialogOpen(true)}
            >
              Create Replacement Order
              {selectedForReplacement.size > 0 && (
                <span className="opacity-75">({selectedForReplacement.size})</span>
              )}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1 ml-1">
            {purchaseOrder.replacementOrderCount > 0 && (
              <Badge variant="amber" className="rounded px-1.5 text-[10px]">
                Replacement: {purchaseOrder.replacementOrderCount}
              </Badge>
            )}
            <Button
              size="xs"
              variant="outline"
              className="text-[10px] rounded-[5px] gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
              disabled={orderEditMode}
              onClick={enterReplacementSelectMode}
            >
              Create Replacement Order
            </Button>
            {!allFulfilled && (
              <Button
                size="xs"
                variant="outline"
                className="text-[10px] rounded-[5px] gap-1 border-red-300 text-red-700 hover:bg-red-50"
                disabled={orderEditMode}
                onClick={() => setRefundDialogOpen(true)}
              >
                Refund Items
              </Button>
            )}
            <Button
              size="xs"
              className="text-[10px] rounded-[5px] gap-1"
              onClick={enterFulfillMode}
              disabled={orderEditMode}
            >
              <ChecklistIcon />
              Fulfill Items
            </Button>
          </div>
        )}
      </div>

      {/* ── Items table ── */}
      <Table
        className="border-collapse text-[11px]"
        style={{ tableLayout: 'fixed' }}
      >
        <colgroup>
          <col style={{ width: '8%' }} />
          <col
            style={{
              width:
                fulfillMode && orderEditMode
                  ? '18%'
                  : fulfillMode
                    ? '20%'
                    : orderEditMode
                      ? '22%'
                      : '24%',
            }}
          />
          <col style={{ width: '2.25rem' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '8%' }} />
          <col
            style={{
              width: fulfillMode || orderEditMode ? '10%' : '8%',
            }}
          />
          <col style={{ width: fulfillMode ? '9%' : '8%' }} />
          <col
            style={{
              width: fulfillMode ? '14%' : orderEditMode ? '13%' : '16%',
            }}
          />
          <col
            style={{
              width: fulfillMode ? '12%' : orderEditMode ? '11%' : '13%',
            }}
          />
          {orderEditMode && <col style={{ width: '10%' }} />}
          {fulfillMode && <col style={{ width: '6%' }} />}
        </colgroup>

        <thead>
          <TableRow className="border-0 hover:bg-transparent">
            {(
              [
                ['num', 'Shopify #', 'left'],
                ['product', 'Product', 'left'],
                ['admin', '', 'center'],
                ['ref', 'Ref.', 'left'],
                ['cost', orderEditMode ? 'Shopify price' : 'Cost', 'left'],
                ['qty', 'Qty', 'left'],
                ['recv', 'Received', 'left'],
                ['note', 'Note', 'left'],
                ['status', 'Status', 'left'],
              ] as const
            ).map(([id, label, align]) => (
              <TableHead
                key={id}
                className={cn(
                  'text-[9px] font-medium text-muted-foreground py-[5px] border-b uppercase tracking-wide h-auto',
                  align === 'center'
                    ? 'w-10 px-1 text-center'
                    : 'px-3 text-left',
                )}
              >
                {label}
              </TableHead>
            ))}
            {orderEditMode && (
              <TableHead className="text-[9px] font-medium text-muted-foreground px-3 py-[5px] border-b text-right uppercase tracking-wide h-auto">
                Edit
              </TableHead>
            )}
            {fulfillMode && (
              <TableHead className="px-3 py-[5px] border-b h-auto text-center">
                <input
                  type="checkbox"
                  checked={allItemsChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked;
                  }}
                  onChange={toggleAll}
                  className="h-3 w-3 cursor-pointer accent-foreground"
                />
              </TableHead>
            )}
          </TableRow>
        </thead>

        <TableBody>
          {tableRows.map((item) => {
            const row = item as EditPoLine;
            const isChecked = !!checked[item.id];
            const rowDisabled = fulfillMode && !isChecked;
            const editable =
              orderEditMode &&
              (Boolean(row.shopifyLineItemGid) || Boolean(row._isNew));

            return (
              <TableRow
                key={orderEditMode ? row._local : item.id}
                className={cn(
                  'border-b last:border-b-0',
                  fulfillMode
                    ? isChecked
                      ? 'bg-blue-50/40 hover:bg-blue-50/60'
                      : 'opacity-40 hover:opacity-50'
                    : replacementSelectMode
                      ? selectedForReplacement.has(item.id)
                        ? 'hover:bg-muted/30'
                        : 'opacity-40 hover:opacity-50'
                      : 'hover:bg-muted/30',
                )}
              >
                {/* Shopify order # + custom order selector */}
                <TableCell className="px-3 py-[7px]">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      {replacementSelectMode && (
                        <input
                          type="checkbox"
                          checked={selectedForReplacement.has(item.id)}
                          onChange={() => toggleReplacementSelect(item.id)}
                          className="h-3 w-3 cursor-pointer accent-amber-600 shrink-0"
                          title="Include in replacement order"
                        />
                      )}
                      <Badge variant="blue" className={badgeCompact}>
                        {item.shopifyOrderNumber}
                      </Badge>
                    </div>
                    {(item.replacementQty ?? 0) > 0 && (
                      <span className="text-[9px] text-amber-700 font-medium leading-none">
                        → {item.replacementQty} replacement
                      </span>
                    )}
                  </div>
                </TableCell>

                {/* Product */}
                <TableCell className="px-3 py-[7px]">
                  <ShopifyLineProductCell
                    linkMode="none"
                    shopifyAdminStoreHandle={shopifyAdminStoreHandle}
                    shopifyProductGid={item.shopifyProductGid}
                    shopifyVariantGid={item.shopifyVariantGid}
                    imageUrl={item.imageUrl}
                    label={formatProductLabel(item)}
                    sku={item.sku}
                    afterTitle={
                      item.isCustom ? (
                        <span className="text-[9px] text-muted-foreground ml-1">
                          (custom)
                        </span>
                      ) : null
                    }
                  />
                </TableCell>

                <TableCell className="w-10 px-1 py-[7px] text-center align-middle">
                  <ShopifyProductAdminArrowLink
                    shopifyAdminStoreHandle={shopifyAdminStoreHandle}
                    shopifyProductGid={item.shopifyProductGid}
                    shopifyVariantGid={item.shopifyVariantGid}
                  />
                </TableCell>

                {/* Ref */}
                <TableCell className="px-3 py-[7px] text-[9px] font-mono text-muted-foreground">
                  {item.supplierRef ?? '—'}
                </TableCell>

                {/* Cost (view) / Shopify unit price when editing order lines */}
                <TableCell className="px-3 py-[7px] text-[11px]">
                  {editable ? (
                    <Input
                      className="h-7 text-[11px]"
                      value={item.itemPrice ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEditLines((prev) =>
                          prev.map((d) =>
                            d._local === row._local
                              ? { ...d, itemPrice: v || null }
                              : d,
                          ),
                        );
                      }}
                    />
                  ) : (
                    formatItemPrice(
                      item.itemCost ?? null,
                      purchaseOrder.currency,
                    )
                  )}
                </TableCell>

                <TableCell className="px-3 py-[7px] text-[11px]">
                  {editable ? (
                    <Input
                      className="h-7 min-w-14 w-full max-w-[5.5rem] text-[11px] tabular-nums"
                      type="number"
                      min={0}
                      value={item.quantity}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        setEditLines((prev) =>
                          prev.map((d) =>
                            d._local === row._local
                              ? {
                                  ...d,
                                  quantity: Number.isFinite(n)
                                    ? Math.max(0, n)
                                    : 0,
                                }
                              : d,
                          ),
                        );
                      }}
                    />
                  ) : replacementSelectMode ? (
                    <QtyField
                      value={replacementQtyOverrides[item.id] ?? item.quantity}
                      onChange={(n) =>
                        setReplacementQtyOverrides((prev) => ({ ...prev, [item.id]: n }))
                      }
                      originalQty={item.quantity}
                      className="min-w-14 w-full max-w-[5.5rem]"
                    />
                  ) : (
                    item.quantity
                  )}
                </TableCell>

                <TableCell
                  className={cn(
                    'px-3 py-[7px] text-[11px] font-medium',
                    !fulfillMode && recvCellTone(item.fulfillmentStatus),
                  )}
                >
                  {fulfillMode ? (
                    <Input
                      type="number"
                      min={0}
                      max={item.quantity}
                      value={recvValues[item.id] ?? item.quantityReceived}
                      disabled={rowDisabled}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setRecv(item.id, isNaN(v) ? 0 : v);
                      }}
                      onFocus={(e) => e.target.select()}
                      className="min-w-14 w-full max-w-[5.5rem] h-auto min-h-0 text-[11px] px-2 py-[2px] text-center tabular-nums md:text-[11px] disabled:opacity-30"
                    />
                  ) : (
                    <span className={recvCellTone(item.fulfillmentStatus)}>
                      {item.quantityReceived === 0
                        ? '—'
                        : item.quantityReceived}
                    </span>
                  )}
                </TableCell>

                <TableCell className="px-2 py-[7px] align-top min-w-0">
                  {fulfillMode || orderEditMode ? (
                    <span className="text-[10px] text-muted-foreground break-words whitespace-pre-wrap">
                      {item.note?.trim() ? item.note : '—'}
                    </span>
                  ) : noteEditingId === item.id ? (
                    <div className="flex flex-col gap-1">
                      <Textarea
                        className="min-h-[5.5rem] max-h-40 resize-y text-[10px] leading-snug py-1.5"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        maxLength={4000}
                        rows={4}
                        placeholder="PO line note (shown on PDF). Enter for new lines."
                      />
                      <div className="flex gap-1 justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="h-6 text-[10px]"
                          disabled={noteSaving}
                          onClick={() => {
                            setNoteEditingId(null);
                            setNoteDraft('');
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          className="h-6 text-[10px]"
                          disabled={noteSaving}
                          onClick={() => {
                            void (async () => {
                              setNoteSaving(true);
                              try {
                                const res = await fetch(
                                  `/api/order/purchase-orders/${purchaseOrder.id}/line-items`,
                                  {
                                    method: 'PATCH',
                                    headers: {
                                      'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify({
                                      items: [
                                        {
                                          id: item.id,
                                          note: noteDraft || null,
                                        },
                                      ],
                                    }),
                                  },
                                );
                                const body = (await res
                                  .json()
                                  .catch(() => null)) as {
                                  error?: string;
                                } | null;
                                if (!res.ok) {
                                  toast.error(
                                    body?.error ?? 'Failed to save note',
                                  );
                                  return;
                                }
                                toast.success('Note saved');
                                setNoteEditingId(null);
                                setNoteDraft('');
                                router.refresh();
                              } catch {
                                toast.error('Network error');
                              } finally {
                                setNoteSaving(false);
                              }
                            })();
                          }}
                        >
                          {noteSaving ? '…' : 'Save'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <p className="text-[10px] text-muted-foreground break-words whitespace-pre-wrap max-h-[4.5rem] overflow-y-auto">
                        {item.note?.trim() ? item.note : '—'}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        className="h-6 text-[10px] self-start"
                        onClick={() => {
                          setNoteEditingId(item.id);
                          setNoteDraft(item.note ?? '');
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  )}
                </TableCell>

                <TableCell className="px-3 py-[7px]">
                  <StatusBadge status={item.fulfillmentStatus} />
                </TableCell>

                {orderEditMode && (
                  <TableCell className="px-3 py-[7px] text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-[10px] h-7 text-destructive"
                      onClick={() => {
                        if (row.shopifyLineItemGid) {
                          setEditLines((prev) =>
                            prev.map((d) =>
                              d._local === row._local
                                ? { ...d, _removed: true }
                                : d,
                            ),
                          );
                        } else {
                          setEditLines((prev) =>
                            prev.filter((d) => d._local !== row._local),
                          );
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </TableCell>
                )}

                {fulfillMode && (
                  <TableCell className="px-3 py-[7px] text-center">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleItem(item.id)}
                      className="h-3 w-3 cursor-pointer accent-foreground"
                    />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="px-3.5 py-[6px] border-t text-[11px] flex items-center justify-end gap-2">
        <span className="text-muted-foreground">Subtotal (cost)</span>
        <span className="font-medium tabular-nums">
          {formatMoney(costSubtotal, purchaseOrder.currency)}
        </span>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Add PO line (Shopify)</DialogTitle>
          </DialogHeader>
          <ShopifyProductSearchPanel onSelect={(h) => addSearchHitToPo(h)} />
        </DialogContent>
      </Dialog>

      <CreateReplacementOrderDialog
        open={replacementOrderDialogOpen}
        onOpenChange={(open) => {
          setReplacementOrderDialogOpen(open);
          if (!open) {
            setSelectedForReplacement(new Set());
            setReplacementQtyOverrides({});
            setReplacementSelectMode(false);
          }
        }}
        selectedItems={selectedItemsForReplacement}
        sourcePOId={purchaseOrder.id}
        referenceOrderNames={referenceOrderNames}
        initialQtyOverrides={replacementQtyOverrides}
      />
      <RefundCreateDialog
        open={refundDialogOpen}
        onOpenChange={setRefundDialogOpen}
        purchaseOrderId={purchaseOrder.id}
        poLineItems={items}
      />
    </div>
  );
}
