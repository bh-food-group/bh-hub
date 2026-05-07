'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { LineItemThumb } from './LineItemThumb';
import { QtyField } from './QtyField';
import { ReasonSelector, type ReasonValue } from './ReasonSelector';
import type { PoLineItemView } from '../types';
import { formatProductLabel } from '../types/purchase-order';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrderId: string;
  poLineItems: PoLineItemView[];
};

const DEFAULT_REASON: ReasonValue = { category: '', subcategory: '', notes: '' };

// Only items with a Shopify line item GID can be refunded via orderEdit
function isRefundable(item: PoLineItemView): boolean {
  return !!item.shopifyLineItemGid && !!item.shopifyOrderId && item.fulfillmentStatus !== 'FULFILLED';
}

export function RefundCreateDialog({ open, onOpenChange, purchaseOrderId, poLineItems }: Props) {
  const [creating, setCreating] = useState(false);
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReasonValue>(DEFAULT_REASON);

  const refundableItems = poLineItems.filter(isRefundable);

  useEffect(() => {
    if (!open) {
      setQtyOverrides({});
      setReason(DEFAULT_REASON);
    }
  }, [open]);

  function getQty(item: PoLineItemView): number {
    return qtyOverrides[item.id] ?? item.quantity;
  }

  function setQty(id: string, val: number) {
    setQtyOverrides((prev) => ({ ...prev, [id]: Math.max(1, val) }));
  }

  async function handleCreate() {
    if (!reason.category) return;
    setCreating(true);
    try {
      const res = await fetch('/api/order/refund-replacements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseOrderId,
          lineItems: refundableItems.map((item) => ({
            purchaseOrderLineItemId: item.id,
            shopifyOrderId: item.shopifyOrderId!,
            shopifyLineItemGid: item.shopifyLineItemGid!,
            productTitle: item.productTitle ?? '(untitled)',
            variantTitle: item.variantTitle ?? null,
            sku: item.sku ?? null,
            quantity: getQty(item),
            unitPrice: item.itemPrice ? parseFloat(item.itemPrice) : null,
          })),
          reasonCategory: reason.category,
          reasonSubcategory: reason.subcategory,
          reasonNotes: reason.notes || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Failed to create refund');
      }

      toast.success('Refund created — Shopify order updated');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error creating refund');
    } finally {
      setCreating(false);
    }
  }

  const canSubmit = reason.category !== '' && reason.subcategory !== '' && refundableItems.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Create Refund
            <Badge variant="destructive" className="rounded px-1.5 text-[10px]">
              REFUND
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {refundableItems.length === 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              No refundable items — items must have a linked Shopify order and not yet be fulfilled.
            </div>
          ) : (
            <>
              <div className="text-[11px] text-muted-foreground">
                {refundableItems.length} item{refundableItems.length !== 1 ? 's' : ''} will be
                removed from the Shopify order (quantity set to 0). Adjust qty as needed.
              </div>

              <Table>
                <thead>
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableHead className="px-3 py-2 text-[10px] text-left">Product</TableHead>
                    <TableHead className="px-3 py-2 text-[10px] text-left">SKU</TableHead>
                    <TableHead className="px-3 py-2 text-[10px] text-left w-24">Qty</TableHead>
                    <TableHead className="px-3 py-2 text-[10px] text-left">Price</TableHead>
                  </TableRow>
                </thead>
                <TableBody>
                  {refundableItems.map((item) => (
                    <TableRow key={item.id} className="border-0">
                      <TableCell className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <LineItemThumb imageUrl={item.imageUrl} size="sm" label={item.productTitle ?? ''} />
                          <div className="text-[11px] font-medium leading-tight">
                            {formatProductLabel(item)}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                        {item.sku ?? '—'}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <QtyField
                          value={getQty(item)}
                          onChange={(n) => setQty(item.id, n)}
                          originalQty={item.quantity}
                          className="w-20"
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2 text-[11px]">
                        {item.itemPrice ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}

          <ReasonSelector value={reason} onChange={setReason} disabled={creating} />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={creating}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleCreate}
              disabled={creating || !canSubmit}
            >
              {creating ? 'Creating…' : 'Create Refund'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
