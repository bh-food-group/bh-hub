'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
  selectedItems: PoLineItemView[];
  sourcePOId: string;
  referenceOrderNames: string | null;
  /** Qty values pre-set from the table's selection mode. */
  initialQtyOverrides?: Record<string, number>;
};

export function CreateReplacementOrderDialog({
  open,
  onOpenChange,
  selectedItems,
  sourcePOId,
  referenceOrderNames,
  initialQtyOverrides,
}: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReasonValue>({ category: '', subcategory: '', notes: '' });

  useEffect(() => {
    if (open) {
      setQtyOverrides(initialQtyOverrides ?? {});
      setReason({ category: '', subcategory: '', notes: '' });
    } else {
      setQtyOverrides({});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function getQty(item: PoLineItemView): number {
    return qtyOverrides[item.id] ?? item.quantity;
  }

  function setQty(id: string, val: number) {
    setQtyOverrides((prev) => ({ ...prev, [id]: Math.max(1, val) }));
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch('/api/order/replacement-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePurchaseOrderId: sourcePOId,
          lineItems: selectedItems.map((item) => ({
            sku: item.sku ?? null,
            productTitle: item.productTitle ?? '(untitled)',
            variantTitle: item.variantTitle ?? null,
            quantity: getQty(item),
            itemPrice: item.itemPrice ?? null,
            shopifyVariantGid: item.shopifyVariantGid ?? null,
            shopifyProductGid: item.shopifyProductGid ?? null,
            imageUrl: item.imageUrl ?? null,
            vendor: null,
            sourcePurchaseOrderLineItemId: item.id,
          })),
          reasonCategory: reason.category || undefined,
          reasonSubcategory: reason.subcategory || undefined,
          reasonNotes: reason.notes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Failed to create replacement order');
      }

      toast.success('Replacement order created');
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error creating replacement order');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Create Replacement Order
            <Badge variant="amber" className="rounded px-1.5 text-[10px]">
              REPLACEMENT
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {referenceOrderNames && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <span className="font-medium">Reference: </span>
              {referenceOrderNames}
              <span className="ml-2 text-amber-600">
                (display only — not linked to Shopify)
              </span>
            </div>
          )}

          <div className="text-[11px] text-muted-foreground">
            {selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''}{' '}
            selected. A replacement order will be created for these items without
            Shopify fulfillment. Adjust qty as needed.
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
              {selectedItems.map((item) => (
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

          <ReasonSelector value={reason} onChange={setReason} disabled={creating} />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={creating || selectedItems.length === 0 || !reason.category}
            >
              {creating ? 'Creating…' : 'Create Replacement Order'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
