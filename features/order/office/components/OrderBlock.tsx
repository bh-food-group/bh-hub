'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import type { PrePoLineDraft, SeparatePoPayload, ShopifyOrderDraft } from '../types';
import { mergeProductAndVariantTitle } from '../types/purchase-order';
import {
  ShopifyLineProductCell,
  ShopifyProductAdminArrowLink,
} from './ShopifyLineProductCell';
import { formatItemPrice } from '../mappers/map-purchase-order';
import { formatVancouverOrderedDetail } from '../utils/vancouver-datetime';
import { SeparatePoDialog } from './SeparatePoDialog';
import type { ShopifyOrderEditOperation } from '@/lib/api/schemas';
import { shopifyMyshopifyAdminOrderUrl } from '../utils/shopify-admin-order-url';
import {
  ShopifyProductSearchPanel,
  type ShopifyProductSearchHit,
} from '@/components/shopify';

type DraftLine = PrePoLineDraft & {
  localId: string;
  removed?: boolean;
  isNew?: boolean;
  newKind?: 'variant';
};

type Props = {
  shopifyAdminStoreHandle?: string | null;
  order: ShopifyOrderDraft;
  defaultExpectedYmd: string;
  inclusions?: boolean[];
  onToggleInclude?: (orderId: string, itemIdx: number) => void;
  onSeparatePo?: (payload: SeparatePoPayload) => void;
  /** Suggested PO # for Separate PO (same as Meta auto rule for this order). */
  defaultSeparatePoNumber?: string;
  showArchived?: boolean;
  onUnarchiveShopifyOrder?: (shopifyOrderDbId: string) => void;
  /** When saving from a PO context, pass PO id so server can resync lines. */
  purchaseOrderId?: string | null;
  /** Inbox: per-line PO note text (default + edits); parallel to `order.lineItems`. */
  lineItemNotes?: string[];
  onLineItemNoteChange?: (itemIdx: number, value: string) => void;
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

function newLocalId(): string {
  return `l_${Math.random().toString(36).slice(2, 11)}`;
}

function draftFromOrder(order: ShopifyOrderDraft): DraftLine[] {
  return order.lineItems.map((li) => ({
    ...li,
    localId: li.shopifyLineItemGid ?? li.shopifyLineItemId ?? newLocalId(),
  }));
}

export function OrderBlock({
  shopifyAdminStoreHandle,
  order,
  defaultExpectedYmd,
  inclusions,
  onToggleInclude,
  onSeparatePo,
  defaultSeparatePoNumber,
  showArchived,
  onUnarchiveShopifyOrder,
  purchaseOrderId,
  lineItemNotes,
  onLineItemNoteChange,
}: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftLines, setDraftLines] = useState<DraftLine[]>(() => draftFromOrder(order));
  const [saving, setSaving] = useState(false);
  const originalByGid = useRef<Map<string, { quantity: number; itemPrice: string | null }>>(
    new Map(),
  );
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraftLines(draftFromOrder(order));
    }
  }, [order, editing]);

  const getIncluded = (idx: number) =>
    inclusions ? inclusions[idx] : order.lineItems[idx]?.includeInPo ?? true;
  const excluded = order.lineItems.filter((_, idx) => !getIncluded(idx));
  const displayName =
    order.customerDisplayName ?? order.orderNumber.replace(/^#/, 'Order ');
  const shopifyAdminOrderUrl = shopifyMyshopifyAdminOrderUrl(
    order.shopifyOrderGid,
  );

  const beginEdit = useCallback(() => {
    const m = new Map<string, { quantity: number; itemPrice: string | null }>();
    for (const li of order.lineItems) {
      if (li.shopifyLineItemGid) {
        m.set(li.shopifyLineItemGid, { quantity: li.quantity, itemPrice: li.itemPrice });
      }
    }
    originalByGid.current = m;
    setDraftLines(draftFromOrder(order));
    setEditing(true);
  }, [order]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraftLines(draftFromOrder(order));
  }, [order]);

  const buildSavePayload = useCallback(async () => {
    const ops: ShopifyOrderEditOperation[] = [];
    const orig = originalByGid.current;

    for (const [gid, o] of orig) {
      const row = draftLines.find((d) => d.shopifyLineItemGid === gid && !d.removed);
      if (!row) {
        ops.push({ type: 'setQuantity', shopifyLineItemGid: gid, quantity: 0, restock: false });
        continue;
      }
      if (row.quantity !== o.quantity) {
        ops.push({
          type: 'setQuantity',
          shopifyLineItemGid: gid,
          quantity: row.quantity,
          restock: false,
        });
      }
    }

    for (const row of draftLines) {
      if (row.removed || row.shopifyLineItemGid) continue;
      if (row.isNew && row.newKind === 'variant' && row.shopifyVariantGid) {
        const unit = parseMoney(row.itemPrice);
        ops.push({
          type: 'addVariant',
          variantGid: row.shopifyVariantGid,
          quantity: Math.max(1, row.quantity),
          allowDuplicates: true,
          unitPriceOverride: unit > 0 ? unit : undefined,
        });
      }
    }

    return { ops };
  }, [draftLines]);

  const saveReplacementEdit = useCallback(async () => {
    type DbOp =
      | { type: 'setQuantity'; lineItemId: string; quantity: number }
      | { type: 'removeLine'; lineItemId: string }
      | { type: 'addLine'; productTitle: string; quantity: number; sku?: string | null; itemPrice?: string | null; shopifyVariantGid?: string | null; shopifyProductGid?: string | null; imageUrl?: string | null };

    const ops: DbOp[] = [];

    for (const orig of order.lineItems) {
      if (!orig.shopifyLineItemId) continue;
      const curr = draftLines.find((d) => d.shopifyLineItemId === orig.shopifyLineItemId && !d.removed);
      if (!curr) {
        ops.push({ type: 'removeLine', lineItemId: orig.shopifyLineItemId });
      } else if (curr.quantity !== orig.quantity) {
        ops.push({ type: 'setQuantity', lineItemId: orig.shopifyLineItemId, quantity: curr.quantity });
      }
    }

    for (const row of draftLines) {
      if (row.removed || row.shopifyLineItemId) continue;
      if (row.isNew && row.newKind === 'variant') {
        ops.push({
          type: 'addLine',
          productTitle: row.productTitle,
          quantity: Math.max(1, row.quantity),
          sku: row.sku,
          shopifyVariantGid: row.shopifyVariantGid ?? null,
          shopifyProductGid: row.shopifyProductGid ?? null,
          imageUrl: row.imageUrl ?? null,
          itemPrice: row.itemPrice ?? null,
        });
      }
    }

    if (ops.length === 0) {
      toast.message('No changes to save');
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/order/replacement-orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations: ops }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof body?.error === 'string' ? body.error : 'Save failed');
        return;
      }
      toast.success('Replacement order updated');
      setEditing(false);
      router.refresh();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }, [order, draftLines, router]);

  const saveEdit = useCallback(async () => {
    if (order.isReplacementOrder) {
      return saveReplacementEdit();
    }
    if (!order.shopifyOrderGid) {
      toast.error('This order is missing a Shopify reference.');
      return;
    }
    setSaving(true);
    try {
      const { ops } = await buildSavePayload();
      if (ops.length === 0) {
        toast.message('No changes to save');
        setEditing(false);
        return;
      }

      const hasAppend = ops.some((o) => o.type === 'addVariant');

      const res = await fetch(`/api/shopify/orders/${order.id}/apply-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: ops,
          purchaseOrderId: purchaseOrderId ?? undefined,
          appendLinesFromShopifyOrderLocalId: hasAppend ? order.id : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof body?.error === 'string' ? body.error : 'Save failed');
        return;
      }
      toast.success('Order updated');
      setEditing(false);
      router.refresh();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }, [order, purchaseOrderId, saveReplacementEdit, buildSavePayload, router]);

  const addSearchHit = useCallback((hit: ShopifyProductSearchHit) => {
    const price = hit.price ?? '0';
    setDraftLines((prev) => [
      ...prev,
      {
        localId: newLocalId(),
        isNew: true,
        newKind: 'variant',
        shopifyLineItemId: undefined,
        shopifyLineItemGid: undefined,
        shopifyVariantGid: hit.variantId,
        shopifyProductGid: hit.productId,
        sku: hit.sku,
        imageUrl: hit.imageUrl ?? null,
        productTitle: mergeProductAndVariantTitle(hit.productTitle, hit.variantTitle),
        itemPrice: price,
        itemCost: hit.unitCost ?? null,
        quantity: 1,
        includeInPo: true,
      },
    ]);
    setAddOpen(false);
  }, []);

  const visibleDrafts = useMemo(() => draftLines.filter((d) => !d.removed), [draftLines]);
  const costSubtotal = useMemo(() => {
    const source = editing ? visibleDrafts : order.lineItems;
    return source.reduce((sum, line) => {
      return sum + parseMoney(line.itemCost ?? null) * Math.max(0, line.quantity ?? 0);
    }, 0);
  }, [editing, visibleDrafts, order.lineItems]);

  const showLinePoNotes =
    !editing && Boolean(onLineItemNoteChange) && lineItemNotes != null;

  return (
    <div className="bg-background border border-border rounded-[10px] overflow-hidden mb-2">
      <div className="px-3.5 py-2 border-b bg-muted/40 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[12px] font-medium">
            {order.isReplacementOrder ? (
              <>
                <Badge variant="blue" className="rounded px-1.5 text-[10px]">
                  {order.referenceOrderNames ?? order.orderNumber}
                </Badge>
                <Badge variant="amber" className="rounded px-1.5 text-[10px]">
                  REPLACEMENT
                </Badge>
              </>
            ) : shopifyAdminOrderUrl ? (
              <a
                href={shopifyAdminOrderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex"
                title="Open order in Shopify Admin"
              >
                <Badge
                  variant="blue"
                  className="rounded px-1.5 text-[10px] cursor-pointer hover:opacity-90"
                >
                  {order.orderNumber}
                </Badge>
              </a>
            ) : (
              <Badge variant="blue" className="rounded px-1.5 text-[10px]">
                {order.orderNumber}
              </Badge>
            )}
            {displayName}
          </div>
          <div className="flex gap-2.5 flex-wrap">
            {order.orderedAt && (
              <span className="text-[10px] text-muted-foreground">
                Ordered {formatVancouverOrderedDetail(order.orderedAt)}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {order.customerEmail ?? '—'}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {order.shippingAddressLine ?? '—'}
            </span>
          </div>
        </div>
        <div className="flex flex-shrink-0 gap-1 mt-0.5">
          {editing ? (
            <>
              <Button
                variant="outline"
                size="xs"
                className="text-[10px] rounded-[5px]"
                onClick={cancelEdit}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                size="xs"
                className="text-[10px] rounded-[5px] gap-1"
                onClick={() => void saveEdit()}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="size-3.5 shrink-0 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </>
          ) : showArchived ? (
            onUnarchiveShopifyOrder ? (
              <Button
                variant="outline"
                size="xs"
                className="text-[10px] rounded-[5px]"
                onClick={() => void onUnarchiveShopifyOrder(order.id)}
              >
                Unarchive
              </Button>
            ) : null
          ) : order.isReplacementOrder ? (
            <>
              <Button
                variant="outline"
                size="xs"
                className="text-[10px] rounded-[5px]"
                onClick={beginEdit}
              >
                Edit
              </Button>
              <Button
                variant="outline"
                size="xs"
                className="text-[10px] rounded-[5px]"
                onClick={() => setDialogOpen(true)}
              >
                Create PO
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="xs"
                className="text-[10px] rounded-[5px]"
                onClick={beginEdit}
              >
                Edit order
              </Button>
              <Button
                variant="outline"
                size="xs"
                className="text-[10px] rounded-[5px]"
                onClick={() => setDialogOpen(true)}
              >
                Separate PO
              </Button>
            </>
          )}
        </div>
      </div>

      {order.note && (
        <div
          className={cn(
            'px-3.5 py-2.5 border-b',
            order.noteIsWarning
              ? 'bg-red-50 border-red-200 dark:bg-red-950/35 dark:border-red-900'
              : 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900',
          )}
        >
          <div
            className={cn(
              'text-[10px] font-semibold uppercase tracking-wide',
              order.noteIsWarning
                ? 'text-red-900 dark:text-red-200'
                : 'text-amber-950 dark:text-amber-100',
            )}
          >
            Customer note
          </div>
          <p
            className={cn(
              'text-[12px] leading-snug mt-1 whitespace-pre-wrap break-words',
              order.noteIsWarning
                ? 'text-red-950 dark:text-red-50'
                : 'text-amber-950 dark:text-amber-50',
            )}
          >
            {order.note}
          </p>
        </div>
      )}

      {onSeparatePo && (
        <SeparatePoDialog
          order={order}
          defaultPoNumber={defaultSeparatePoNumber ?? ''}
          defaultExpectedYmd={defaultExpectedYmd}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          lineItemNotes={lineItemNotes}
          onCreatePo={(payload) => {
            onSeparatePo(payload);
            setDialogOpen(false);
          }}
        />
      )}

      {editing && (
        <div className="px-3.5 py-1.5 border-b flex items-center gap-2 bg-muted/20">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="text-[10px] rounded-[5px]"
            onClick={() => setAddOpen(true)}
          >
            Add line
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {order.isReplacementOrder
              ? 'Changes apply to the replacement order only.'
              : 'Fulfilled lines may be blocked by Shopify from editing.'}
          </span>
        </div>
      )}

      <Table
        className="border-collapse text-[11px]"
        style={{ tableLayout: 'fixed' }}
      >
        <colgroup>
          <col style={{ width: editing ? '24%' : showLinePoNotes ? '25%' : '32%' }} />
          <col style={{ width: '2.25rem' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: editing ? '9%' : '10%' }} />
          <col style={{ width: editing ? '13%' : '10%' }} />
          {showLinePoNotes ? <col style={{ width: '18%' }} /> : null}
          <col style={{ width: editing ? '12%' : '8%' }} />
          {!editing && <col style={{ width: '5%' }} />}
        </colgroup>
        <thead>
          <TableRow className="border-0 hover:bg-transparent">
            {(
              [
                ['product', 'Product', 'left'] as const,
                ['shopify', '', 'center'] as const,
                ['sku', 'SKU', 'left'] as const,
                ['price', 'Price', 'left'] as const,
                ['cost', 'Cost', 'left'] as const,
                ['qty', 'Qty', 'left'] as const,
                ...(showLinePoNotes ? [['po-note', 'PO line note', 'left'] as const] : []),
                ...(editing
                  ? [['edit-actions', '', 'right'] as const]
                  : [['include', 'Include', 'right'] as const]),
              ] as const
            ).map(([id, h, align]) => (
              <TableHead
                key={id}
                className={cn(
                  'text-[9px] font-medium text-muted-foreground px-3 py-[5px] border-b uppercase tracking-wide h-auto',
                  align === 'right'
                    ? 'text-right'
                    : align === 'center'
                      ? 'text-center w-10 px-1'
                      : 'text-left',
                )}
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </thead>
        <TableBody>
          {(editing ? visibleDrafts : order.lineItems).map((item, idx) => {
            const row = editing
              ? (item as DraftLine)
              : (order.lineItems[idx] as PrePoLineDraft);
            const included = editing ? true : getIncluded(idx);
            return (
              <TableRow
                key={editing ? (row as DraftLine).localId : `${order.id}-${idx}-${row.sku ?? row.productTitle}`}
                className={cn(
                  'border-b last:border-b-0 hover:bg-muted/30',
                  !editing && !included && 'opacity-40',
                  editing && (row as DraftLine).removed && 'hidden',
                )}
              >
                <TableCell className="px-3 py-[7px]">
                  <ShopifyLineProductCell
                    linkMode="none"
                    shopifyAdminStoreHandle={shopifyAdminStoreHandle}
                    shopifyProductGid={(row as PrePoLineDraft).shopifyProductGid}
                    shopifyVariantGid={(row as PrePoLineDraft).shopifyVariantGid}
                    imageUrl={row.imageUrl}
                    label={row.productTitle}
                    sku={row.sku}
                  />
                </TableCell>
                <TableCell className="w-10 px-1 py-[7px] text-center align-middle">
                  <ShopifyProductAdminArrowLink
                    shopifyAdminStoreHandle={shopifyAdminStoreHandle}
                    shopifyProductGid={(row as PrePoLineDraft).shopifyProductGid}
                    shopifyVariantGid={(row as PrePoLineDraft).shopifyVariantGid}
                  />
                </TableCell>
                <TableCell className="px-3 py-[7px] text-[9px] font-mono text-muted-foreground">
                  {row.sku ?? '—'}
                </TableCell>
                <TableCell className="px-3 py-[7px] text-[11px]">
                  {editing ? (
                    <span>{formatItemPrice(row.itemPrice)}</span>
                  ) : (
                    formatItemPrice(row.itemPrice)
                  )}
                </TableCell>
                <TableCell className="px-3 py-[7px] text-[11px]">
                  {formatItemPrice((row as PrePoLineDraft).itemCost ?? null)}
                </TableCell>
                <TableCell
                  className={cn(
                    'px-3 py-[7px] text-[11px] tabular-nums',
                    row.disabled && 'text-muted-foreground',
                  )}
                >
                  {editing ? (
                    <Input
                      className="h-7 min-w-14 w-full max-w-[5.5rem] text-[11px] tabular-nums"
                      type="number"
                      min={0}
                      value={row.quantity}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        setDraftLines((prev) =>
                          prev.map((d) =>
                            d.localId === (row as DraftLine).localId
                              ? { ...d, quantity: Number.isFinite(n) ? Math.max(0, n) : 0 }
                              : d,
                          ),
                        );
                      }}
                    />
                  ) : (
                    row.quantity
                  )}
                </TableCell>
                {showLinePoNotes ? (
                  <TableCell className="px-3 py-[7px] align-top">
                    {(row as PrePoLineDraft).defaultPoLineNote?.trim() ? (
                      <div className="text-[9px] text-muted-foreground mb-1 line-clamp-2 whitespace-pre-wrap">
                        Default: {(row as PrePoLineDraft).defaultPoLineNote!.trim()}
                      </div>
                    ) : null}
                    <Textarea
                      className="min-h-[3.25rem] max-h-28 resize-y text-[10px] leading-snug py-1 md:text-[10px]"
                      value={lineItemNotes![idx] ?? ''}
                      onChange={(e) => onLineItemNoteChange?.(idx, e.target.value)}
                      placeholder="PO / PDF line note (override)"
                      maxLength={4000}
                      rows={2}
                      disabled={!included}
                    />
                  </TableCell>
                ) : null}
                {editing ? (
                  <TableCell className="px-3 py-[7px] text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-[10px] h-7 text-destructive"
                      onClick={() => {
                        const dl = row as DraftLine;
                        if (dl.shopifyLineItemGid) {
                          setDraftLines((prev) =>
                            prev.map((d) =>
                              d.localId === dl.localId ? { ...d, removed: true } : d,
                            ),
                          );
                        } else {
                          setDraftLines((prev) => prev.filter((d) => d.localId !== dl.localId));
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </TableCell>
                ) : (
                  <TableCell className="px-3 py-[7px] text-right">
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={() => onToggleInclude?.(order.id, idx)}
                      className="align-middle"
                    />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {!editing && excluded.length > 0 && (
        <div className="px-3.5 py-[6px] border-t text-[10px] text-muted-foreground">
          {excluded.map((i) => i.sku ?? i.productTitle).join(', ')} excluded — will not appear
          in PO
        </div>
      )}
      <div className="px-3.5 py-[6px] border-t text-[11px] flex items-center justify-end gap-2">
        <span className="text-muted-foreground">Subtotal (cost)</span>
        <span className="font-medium tabular-nums">
          {formatMoney(costSubtotal, order.currencyCode?.trim() || 'CAD')}
        </span>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Add line</DialogTitle>
          </DialogHeader>
          <ShopifyProductSearchPanel onSelect={(h) => addSearchHit(h)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
