'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { YmdDateInput } from '@/components/ui/ymd-date-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils/cn';
import { formatItemPrice } from '../mappers/map-purchase-order';
import type { PoAddress, ShopifyOrderDraft } from '../types';
import {
  formatDefaultShipToLine,
  resolveSeparatePoShippingAddress,
} from '../utils/order-shipping-json-to-po-address';
import {
  formatVancouverOrderedDetail,
  toVancouverYmdFromIso,
} from '../utils/vancouver-datetime';
import { LineItemThumb } from './LineItemThumb';
import { DeliveryLocationPresetPicker } from './DeliveryLocationPresetPicker';

type Props = {
  order: ShopifyOrderDraft;
  /** Same rule as Inbox Create PO default; user may edit before submit. */
  defaultPoNumber: string;
  defaultExpectedYmd: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreatePo: (payload: {
    poNumber: string;
    expectedDate: string | null;
    comment: string | null;
    shopifyOrderNumber: string;
    lineItems: {
      sku: string | null;
      productTitle: string;
      quantity: number;
      itemPrice: number | null;
      isCustom?: boolean;
      shopifyLineItemId?: string | null;
      shopifyLineItemGid?: string | null;
      shopifyVariantGid?: string | null;
      shopifyProductGid?: string | null;
      note?: string | null;
    }[];
    shippingAddress: PoAddress | null;
    deliveryLocationPresetId?: string | null;
  }) => void;
  /** Inbox draft notes (parallel to `order.lineItems`); snapshotted when dialog opens. */
  lineItemNotes?: string[];
};

export function SeparatePoDialog({
  order,
  defaultPoNumber,
  defaultExpectedYmd,
  open,
  onOpenChange,
  onCreatePo,
  lineItemNotes,
}: Props) {
  const minOrderExpectedYmd = order.orderedAt
    ? toVancouverYmdFromIso(order.orderedAt)
    : null;

  const [expectedDate, setExpectedDate] = useState(defaultExpectedYmd);
  const [shipTo, setShipTo] = useState('');
  const [separatePresetId, setSeparatePresetId] = useState<string | null>(null);
  const [separateFromPreset, setSeparateFromPreset] =
    useState<PoAddress | null>(null);
  const [comment, setComment] = useState('');
  const initialShipToLabelRef = useRef('');
  const lineQtyForSeparatePo = (li: (typeof order.lineItems)[number]) =>
    Math.max(1, li.shopifySourceLineQty ?? li.quantity);

  const [included, setIncluded] = useState<boolean[]>(() =>
    order.lineItems.map(() => true),
  );
  const [quantities, setQuantities] = useState<number[]>(() =>
    order.lineItems.map(lineQtyForSeparatePo),
  );
  const [creating, setCreating] = useState(false);
  const [separateLineNotes, setSeparateLineNotes] = useState<string[]>(() =>
    order.lineItems.map((li) => li.defaultPoLineNote ?? ''),
  );
  const [poNumber, setPoNumber] = useState(defaultPoNumber);
  const [poNumberManual, setPoNumberManual] = useState(false);
  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setSeparateLineNotes(
      order.lineItems.map(
        (li, i) => lineItemNotes?.[i] ?? li.defaultPoLineNote ?? '',
      ),
    );
    // Intentionally omit `lineItemNotes` from deps so edits in this dialog are not wiped
    // when the parent store updates while the dialog stays open.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot when dialog opens
  }, [open, order.id]);

  useEffect(() => {
    if (!open) return;
    setSeparatePresetId(null);
    setSeparateFromPreset(null);
    const label = formatDefaultShipToLine(order);
    initialShipToLabelRef.current = label;
    const minY = order.orderedAt
      ? toVancouverYmdFromIso(order.orderedAt)
      : null;
    let exp = defaultExpectedYmd;
    if (minY && exp < minY) exp = minY;
    setExpectedDate(exp);
    setShipTo(label);
  }, [open, order, defaultExpectedYmd]);

  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open || !justOpened) return;
    setPoNumber(defaultPoNumber);
    setPoNumberManual(false);
    setIncluded(order.lineItems.map(() => true));
    setQuantities(order.lineItems.map(lineQtyForSeparatePo));
  }, [open, order, defaultPoNumber]);

  const anyIncluded = included.some(Boolean);

  function handleToggle(idx: number) {
    setIncluded((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  }

  function handleQtyChange(idx: number, val: number) {
    setQuantities((prev) => {
      const next = [...prev];
      next[idx] = Math.max(1, val);
      return next;
    });
  }

  function handleCreate() {
    setCreating(true);
    const lineItems = order.lineItems.flatMap((li, idx) => {
      if (!included[idx]) return [];
      const rawNote = separateLineNotes[idx] ?? '';
      return [
        {
          sku: li.sku,
          productTitle: li.productTitle,
          quantity: quantities[idx],
          itemPrice: li.itemPrice ? parseFloat(li.itemPrice) : null,
          isCustom: !li.shopifyVariantGid,
          shopifyLineItemId: li.shopifyLineItemId ?? null,
          shopifyLineItemGid: li.shopifyLineItemGid ?? null,
          shopifyVariantGid: li.shopifyVariantGid ?? null,
          shopifyProductGid: li.shopifyProductGid ?? null,
          note: rawNote.trim() || null,
        },
      ];
    });

    const shippingAddress =
      separateFromPreset && separatePresetId
        ? separateFromPreset
        : resolveSeparatePoShippingAddress(
            shipTo,
            order,
            initialShipToLabelRef.current,
          );

    onCreatePo({
      poNumber: poNumber.trim(),
      expectedDate: expectedDate || null,
      comment: comment || null,
      shopifyOrderNumber: order.orderNumber,
      lineItems,
      shippingAddress,
      deliveryLocationPresetId: separatePresetId,
    });
  }

  const displayName =
    order.customerDisplayName ?? order.orderNumber.replace(/^#/, 'Order ');

  function handleDialogOpenChange(next: boolean) {
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge variant="blue" className="rounded px-1.5 text-[10px]">
              {order.orderNumber}
            </Badge>
            Separate PO — {displayName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Order info */}
          <div className="flex gap-3 flex-wrap text-[11px] text-muted-foreground">
            {order.orderedAt && (
              <span>
                Ordered {formatVancouverOrderedDetail(order.orderedAt)}
              </span>
            )}
            <span>{order.customerEmail ?? '—'}</span>
            <span>{order.shippingAddressLine ?? '—'}</span>
          </div>

          {/* Line items table */}
          <div className="border rounded-lg overflow-hidden">
            <Table className="text-[11px]" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '26%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '5%' }} />
              </colgroup>
              <thead>
                <TableRow className="border-0 hover:bg-transparent">
                  {(
                    [
                      ['Product', 'left'],
                      ['SKU', 'left'],
                      ['Price', 'left'],
                      ['Cost', 'left'],
                      ['Qty', 'left'],
                      ['PO line note', 'left'],
                      ['Include', 'right'],
                    ] as const
                  ).map(([h, align]) => (
                    <TableHead
                      key={h}
                      className={cn(
                        'text-[9px] font-medium text-muted-foreground px-3 py-[5px] border-b uppercase tracking-wide h-auto',
                        align === 'right' ? 'text-right' : 'text-left',
                      )}
                    >
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </thead>
              <TableBody>
                {order.lineItems.map((item, idx) => (
                  <TableRow
                    key={`${order.id}-${idx}-${item.sku ?? item.productTitle}`}
                    className={cn(
                      'border-b last:border-b-0 hover:bg-muted/30',
                      !included[idx] && 'opacity-40',
                    )}
                  >
                    <TableCell className="px-3 py-[7px]">
                      <div className="flex gap-2 min-w-0">
                        <LineItemThumb
                          imageUrl={item.imageUrl}
                          label={item.productTitle}
                        />
                        <div className="text-[11px] leading-tight min-w-0 flex-1">
                          {item.productTitle}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-[7px] text-[9px] font-mono text-muted-foreground">
                      {item.sku ?? '—'}
                    </TableCell>
                    <TableCell className="px-3 py-[7px] text-[11px]">
                      {formatItemPrice(item.itemPrice)}
                    </TableCell>
                    <TableCell className="px-3 py-[7px] text-[11px]">
                      {formatItemPrice(item.itemCost ?? null)}
                    </TableCell>
                    <TableCell className="px-3 py-[7px]">
                      <Input
                        type="number"
                        value={quantities[idx]}
                        onChange={(e) =>
                          handleQtyChange(
                            idx,
                            parseInt(e.target.value, 10) || 1,
                          )
                        }
                        disabled={!included[idx]}
                        className="min-w-14 w-full max-w-[5.5rem] h-auto min-h-0 text-[11px] px-2 py-[2px] text-center tabular-nums md:text-[11px]"
                      />
                    </TableCell>
                    <TableCell className="px-3 py-[7px] align-top">
                      {item.defaultPoLineNote?.trim() ? (
                        <div className="text-[9px] text-muted-foreground mb-1 line-clamp-2 whitespace-pre-wrap">
                          Default: {item.defaultPoLineNote.trim()}
                        </div>
                      ) : null}
                      <Textarea
                        className="min-h-[2.75rem] max-h-24 resize-y text-[10px] leading-snug py-1"
                        value={separateLineNotes[idx] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSeparateLineNotes((prev) => {
                            const next = [...prev];
                            next[idx] = v;
                            return next;
                          });
                        }}
                        placeholder="PO / PDF line note"
                        maxLength={4000}
                        rows={2}
                        disabled={!included[idx]}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-[7px] text-right">
                      <input
                        type="checkbox"
                        checked={included[idx]}
                        onChange={() => handleToggle(idx)}
                        className="align-middle"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* PO fields */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">PO number</Label>
            <Input
              type="text"
              value={poNumber}
              onChange={(e) => {
                setPoNumberManual(true);
                setPoNumber(e.target.value);
              }}
              placeholder="Suggested from order · customer · supplier"
              className={cn(
                'h-8 text-sm font-mono',
                !poNumberManual && 'text-muted-foreground',
              )}
            />
            {poNumberManual && (
              <button
                type="button"
                className="text-[9px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setPoNumber(defaultPoNumber);
                  setPoNumberManual(false);
                }}
              >
                Reset to suggested
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Expected date</Label>
              <YmdDateInput
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                min={minOrderExpectedYmd ?? undefined}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <DeliveryLocationPresetPicker
              selectedPresetId={separatePresetId}
              onApply={({ presetId, poAddress }) => {
                setSeparatePresetId(presetId);
                setSeparateFromPreset(poAddress);
                setShipTo(
                  [
                    poAddress.address1,
                    poAddress.address2,
                    poAddress.city,
                    poAddress.province,
                    poAddress.postalCode,
                  ]
                    .filter(Boolean)
                    .join(', '),
                );
              }}
              onClear={() => {
                setSeparatePresetId(null);
                setSeparateFromPreset(null);
                const label = formatDefaultShipToLine(order);
                initialShipToLabelRef.current = label;
                setShipTo(label);
              }}
            />
            <Label className="text-xs font-medium">Ship to</Label>
            <Input
              type="text"
              value={shipTo}
              onChange={(e) => {
                setSeparatePresetId(null);
                setSeparateFromPreset(null);
                setShipTo(e.target.value);
              }}
              placeholder="Address"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Notes</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional"
              className="min-h-14 resize-none text-sm"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              disabled={!anyIncluded || creating}
              className="text-xs"
              onClick={handleCreate}
            >
              {creating ? 'Creating…' : 'Create PO'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
