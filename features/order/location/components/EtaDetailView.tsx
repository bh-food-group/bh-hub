'use client';

import { useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Package } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { enUS } from 'date-fns/locale';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import type { LocationOrderSupplierGroup } from '../types';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  unfulfilled: 'Unfulfilled',
  partially_fulfilled: 'Partially Filled',
  fulfilled: 'Fulfilled',
  completed: 'Completed',
};

type BadgeVariant = 'amber' | 'blue' | 'purple' | 'green' | 'gray' | 'secondary';

const STATUS_BADGE: Record<string, BadgeVariant> = {
  pending: 'amber',
  unfulfilled: 'blue',
  partially_fulfilled: 'purple',
  fulfilled: 'green',
  completed: 'gray',
};

function formatDateShort(iso: string | null): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso.slice(0, 10)), 'MMM d, yyyy', { locale: enUS });
  } catch {
    return iso.slice(0, 10);
  }
}

function fmtCost(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

type Props = {
  date: string;
  locationName: string;
  supplierGroups: LocationOrderSupplierGroup[];
};

export function EtaDetailView({ date, locationName, supplierGroups }: Props) {
  const [openPOs, setOpenPOs] = useState<Set<string>>(new Set());

  function togglePO(id: string) {
    setOpenPOs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const totalPOs = supplierGroups.reduce((s, g) => s + g.purchaseOrders.length, 0);
  const totalCost = supplierGroups.reduce((sum, g) => {
    for (const po of g.purchaseOrders) {
      if (po.totalPrice) sum += parseFloat(po.totalPrice);
    }
    return sum;
  }, 0);

  const formattedDate = (() => {
    try {
      return format(parseISO(date), 'EEEE, MMMM d, yyyy', { locale: enUS });
    } catch {
      return date;
    }
  })();

  return (
    <div className="mx-auto max-w-4xl px-5 py-6">
      {/* Back + header */}
      <div className="mb-6">
        <Link
          href="/order/location"
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to Orders
        </Link>
        <h1 className="text-xl font-semibold">ETA · {formattedDate}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {locationName}
          {' · '}
          {supplierGroups.length} supplier{supplierGroups.length !== 1 ? 's' : ''}
          {' · '}
          {totalPOs} PO{totalPOs !== 1 ? 's' : ''}
          {totalCost > 0 && ` · ${fmtCost(totalCost)}`}
        </p>
      </div>

      {supplierGroups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <Package className="size-10 opacity-40" />
          <p className="text-sm">No orders found for this date.</p>
          <Link href="/order/location" className="text-xs text-primary hover:underline">
            ← Back to Orders
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {supplierGroups.map((group) => (
            <div key={group.supplierId ?? group.supplierName}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.supplierName}
              </p>
              <div className="rounded-lg border border-border bg-card">
                {group.purchaseOrders.map((po) => {
                  const poOpen = openPOs.has(po.id);
                  const badgeVariant: BadgeVariant = STATUS_BADGE[po.status] ?? 'secondary';
                  return (
                    <div key={po.id} className="border-b border-border last:border-0">
                      <button
                        className="flex w-full items-center gap-6 px-4 py-2.5 text-left hover:bg-muted/40"
                        onClick={() => togglePO(po.id)}
                      >
                        {poOpen ? (
                          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="w-48 shrink-0 font-mono text-sm font-medium">
                          {po.poNumber}
                        </span>
                        <Badge variant={badgeVariant} className="shrink-0">
                          {STATUS_LABELS[po.status] ?? po.status}
                        </Badge>
                        <span className="flex-1 truncate text-xs text-muted-foreground">
                          {po.shopifyOrderNames.length > 0
                            ? po.shopifyOrderNames.join(', ')
                            : '—'}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {po.lineItems.length} item{po.lineItems.length !== 1 ? 's' : ''}
                        </span>
                        <div className="flex shrink-0 gap-4">
                          <DateCell label="Ordered" value={po.orderedAt} />
                          <DateCell label="PO Created" value={po.dateCreated} />
                          <DateCell label="ETA" value={po.expectedDate} />
                        </div>
                      </button>

                      {poOpen && (
                        <div className="bg-muted/20 px-4 pb-2 pt-1">
                          {po.comment && (
                            <p className="mb-2 text-xs text-muted-foreground">{po.comment}</p>
                          )}
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border text-muted-foreground">
                                <th className="py-1 text-left font-medium">Item</th>
                                <th className="py-1 text-left font-medium">SKU</th>
                                <th className="py-1 text-right font-medium">Qty</th>
                                <th className="py-1 text-right font-medium">Unit Price</th>
                              </tr>
                            </thead>
                            <tbody>
                              {po.lineItems.map((li) => (
                                <tr
                                  key={li.id}
                                  className="border-b border-border/50 last:border-0"
                                >
                                  <td className="py-1.5 pr-4">
                                    <span className="font-medium">
                                      {li.productTitle ?? '(untitled)'}
                                    </span>
                                    {li.variantTitle &&
                                      li.variantTitle.toLowerCase() !== 'default title' && (
                                        <span className="ml-1 text-muted-foreground">
                                          — {li.variantTitle}
                                        </span>
                                      )}
                                    {li.note && (
                                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                                        {li.note}
                                      </p>
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-4 font-mono text-muted-foreground">
                                    {li.sku ?? '—'}
                                  </td>
                                  <td className="py-1.5 pr-2 text-right">{li.quantity}</td>
                                  <td className="py-1.5 text-right font-mono text-muted-foreground">
                                    {li.itemPrice ? `$${li.itemPrice}` : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DateCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex min-w-[6rem] flex-col items-end">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
        {label}
      </span>
      <span className="text-xs text-muted-foreground">
        {value ? formatDateShort(value) : '—'}
      </span>
    </div>
  );
}
