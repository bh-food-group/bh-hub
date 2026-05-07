'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
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
import { useReasonOptions } from '../hooks/useReasonOptions';
import { ShopifyProductSearchPanel } from '@/components/shopify/ShopifyProductSearchPanel';
import type { ShopifyProductSearchHit } from '@/components/shopify/types';
import type { PoLineItemView } from '../types';
import { formatProductLabel } from '../types/purchase-order';

type ReplacementItem = {
  key: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  itemPrice: string | null;
  shopifyVariantGid: string | null;
  shopifyProductGid: string | null;
  imageUrl: string | null;
  vendor: string | null;
  sourcePurchaseOrderLineItemId: string | null;
};

let _keyCounter = 0;
function newKey() { return `ri-${++_keyCounter}`; }

function poLineToItem(item: PoLineItemView, qty: number): ReplacementItem {
  return {
    key: newKey(),
    productTitle: item.productTitle ?? '(untitled)',
    variantTitle: item.variantTitle ?? null,
    sku: item.sku ?? null,
    quantity: qty,
    itemPrice: item.itemPrice ?? null,
    shopifyVariantGid: item.shopifyVariantGid ?? null,
    shopifyProductGid: item.shopifyProductGid ?? null,
    imageUrl: item.imageUrl ?? null,
    vendor: null,
    sourcePurchaseOrderLineItemId: item.id,
  };
}

function hitToItem(hit: ShopifyProductSearchHit): ReplacementItem {
  return {
    key: newKey(),
    productTitle: hit.productTitle,
    variantTitle: hit.variantTitle ?? null,
    sku: hit.sku ?? null,
    quantity: 1,
    itemPrice: hit.price ?? null,
    shopifyVariantGid: hit.variantId,
    shopifyProductGid: hit.productId,
    imageUrl: hit.imageUrl ?? null,
    vendor: null,
    sourcePurchaseOrderLineItemId: null,
  };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItems: PoLineItemView[];
  sourcePOId: string;
  referenceOrderNames: string | null;
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
  const { options: reasonOptions } = useReasonOptions();
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<ReplacementItem[]>([]);
  const [reason, setReason] = useState<ReasonValue>({ category: '', subcategory: '', notes: '' });
  const [showSearch, setShowSearch] = useState(false);
  const justAddedRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      setItems(
        selectedItems.map((item) =>
          poLineToItem(item, (initialQtyOverrides ?? {})[item.id] ?? item.quantity),
        ),
      );
      setReason({ category: '', subcategory: '', notes: '' });
      setShowSearch(false);
    } else {
      setItems([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function updateQty(key: string, qty: number) {
    setItems((prev) => prev.map((it) => it.key === key ? { ...it, quantity: Math.max(1, qty) } : it));
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  const handleProductSelect = useCallback((hit: ShopifyProductSearchHit) => {
    const newItem = hitToItem(hit);
    justAddedRef.current = newItem.key;
    setItems((prev) => [...prev, newItem]);
  }, []);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch('/api/order/replacement-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePurchaseOrderId: sourcePOId,
          lineItems: items.map((it) => ({
            sku: it.sku,
            productTitle: it.productTitle,
            variantTitle: it.variantTitle,
            quantity: it.quantity,
            itemPrice: it.itemPrice,
            shopifyVariantGid: it.shopifyVariantGid,
            shopifyProductGid: it.shopifyProductGid,
            imageUrl: it.imageUrl,
            vendor: it.vendor,
            sourcePurchaseOrderLineItemId: it.sourcePurchaseOrderLineItemId,
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
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            Create Replacement Order
            <Badge variant="amber" className="rounded px-1.5 text-[10px]">
              REPLACEMENT
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto min-h-0 pr-1">
          {referenceOrderNames && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 flex-shrink-0">
              <span className="font-medium">Reference: </span>
              {referenceOrderNames}
              <span className="ml-2 text-amber-600">(display only — not linked to Shopify)</span>
            </div>
          )}

          {/* Items table */}
          <div className="flex-shrink-0">
            <Table>
              <thead>
                <TableRow className="border-0 hover:bg-transparent">
                  <TableHead className="px-3 py-2 text-[10px] text-left">Product</TableHead>
                  <TableHead className="px-3 py-2 text-[10px] text-left">SKU</TableHead>
                  <TableHead className="px-3 py-2 text-[10px] text-left w-24">Qty</TableHead>
                  <TableHead className="px-3 py-2 text-[10px] text-left">Price</TableHead>
                  <TableHead className="px-2 py-2 w-8" />
                </TableRow>
              </thead>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow className="border-0">
                    <TableCell colSpan={5} className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                      No items — add from catalog below.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow
                      key={item.key}
                      className={`border-0 ${justAddedRef.current === item.key ? 'bg-muted/40' : ''}`}
                    >
                      <TableCell className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <LineItemThumb imageUrl={item.imageUrl} size="sm" label={item.productTitle} />
                          <div className="text-[11px] font-medium leading-tight">
                            {item.productTitle}
                            {item.variantTitle && (
                              <span className="text-muted-foreground font-normal"> — {item.variantTitle}</span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                        {item.sku ?? '—'}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <QtyField
                          value={item.quantity}
                          onChange={(n) => updateQty(item.key, n)}
                          className="w-20"
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2 text-[11px]">
                        {item.itemPrice ?? '—'}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => removeItem(item.key)}
                          disabled={creating}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-40 transition-colors"
                        >
                          <X className="size-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Catalog search */}
          <div className="flex-shrink-0 rounded-md border bg-muted/20">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowSearch((v) => !v)}
            >
              <span className="flex items-center gap-1.5">
                <Plus className="size-3.5" />
                Add from catalog
              </span>
              {showSearch ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
            {showSearch && (
              <div className="px-3 pb-3">
                <ShopifyProductSearchPanel
                  onSelect={handleProductSelect}
                  searchPlaceholder="Search products to add…"
                  resultsMaxHeightClassName="max-h-48"
                />
              </div>
            )}
          </div>

          <ReasonSelector value={reason} onChange={setReason} disabled={creating} options={reasonOptions} />
        </div>

        <div className="flex justify-end gap-2 pt-2 flex-shrink-0 border-t mt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={creating || items.length === 0 || !reason.category}
          >
            {creating ? 'Creating…' : 'Create Replacement Order'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
