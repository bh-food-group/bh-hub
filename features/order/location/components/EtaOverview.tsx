'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { enUS } from 'date-fns/locale';
import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import type { LocationOrderSupplierGroup } from '../types';

type EtaItem = {
  name: string;
  qty: number;
  lineCost: number | null;
  note: string | null;
};

type EtaSupplierEntry = {
  supplierName: string;
  items: EtaItem[];
  totalQty: number;
  totalCost: number | null;
};

type EtaGroup = {
  date: string;
  suppliers: EtaSupplierEntry[];
  totalQty: number;
  totalCost: number | null;
};

function buildEtaGroups(supplierGroups: LocationOrderSupplierGroup[]): EtaGroup[] {
  const map = new Map<
    string,
    Map<string, { items: EtaItem[]; totalCost: number | null; totalQty: number }>
  >();

  for (const sg of supplierGroups) {
    for (const po of sg.purchaseOrders) {
      if (!po.expectedDate) continue;
      const dateKey = po.expectedDate.slice(0, 10);

      if (!map.has(dateKey)) map.set(dateKey, new Map());
      const bySupplier = map.get(dateKey)!;

      if (!bySupplier.has(sg.supplierName)) {
        bySupplier.set(sg.supplierName, { items: [], totalCost: null, totalQty: 0 });
      }
      const entry = bySupplier.get(sg.supplierName)!;

      for (const li of po.lineItems) {
        const unitPrice = li.itemPrice ? parseFloat(li.itemPrice) : null;
        const lineCost = unitPrice !== null ? unitPrice * li.quantity : null;
        const variantSuffix =
          li.variantTitle && li.variantTitle.toLowerCase() !== 'default title'
            ? ` — ${li.variantTitle}`
            : '';
        entry.items.push({
          name: `${li.productTitle ?? '(untitled)'}${variantSuffix}`,
          qty: li.quantity,
          lineCost,
          note: li.note,
        });
        entry.totalQty += li.quantity;
        if (lineCost !== null) {
          entry.totalCost = (entry.totalCost ?? 0) + lineCost;
        }
      }
    }
  }

  const groups: EtaGroup[] = [];
  for (const [date, bySupplier] of map.entries()) {
    let totalCost: number | null = null;
    let totalQty = 0;
    const suppliers: EtaSupplierEntry[] = [];

    for (const [supplierName, data] of bySupplier.entries()) {
      suppliers.push({ supplierName, ...data });
      totalQty += data.totalQty;
      if (data.totalCost !== null) totalCost = (totalCost ?? 0) + data.totalCost;
    }

    groups.push({
      date,
      suppliers: suppliers.sort((a, b) => a.supplierName.localeCompare(b.supplierName)),
      totalQty,
      totalCost,
    });
  }

  return groups.sort((a, b) => b.date.localeCompare(a.date));
}

function fmtDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'EEE, MMM d, yyyy', { locale: enUS });
  } catch {
    return dateStr;
  }
}

function fmtCost(cost: number | null): string {
  if (cost === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cost);
}

const PAGE_SIZE = 3;

export function EtaOverview({
  supplierGroups,
}: {
  supplierGroups: LocationOrderSupplierGroup[];
}) {
  const [openSuppliers, setOpenSuppliers] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);

  const etaGroups = useMemo(() => buildEtaGroups(supplierGroups), [supplierGroups]);

  const pageCount = Math.ceil(etaGroups.length / PAGE_SIZE);
  const visibleGroups = etaGroups.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSupplier(key: string) {
    setOpenSuppliers((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  if (etaGroups.length === 0) return null;

  return (
    <div className="mb-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Deliveries by ETA
        </p>
        {pageCount > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-[2rem] text-center text-[10px] tabular-nums text-muted-foreground">
              {page + 1} / {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {visibleGroups.map((group) => (
          <EtaCard
            key={group.date}
            group={group}
            openSuppliers={openSuppliers}
            onToggle={toggleSupplier}
          />
        ))}
      </div>
    </div>
  );
}

function EtaCard({
  group,
  openSuppliers,
  onToggle,
}: {
  group: EtaGroup;
  openSuppliers: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Card header */}
      <div className="flex items-start justify-between gap-1 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {fmtDate(group.date)}
          </p>
          <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
            {group.suppliers.length} supplier{group.suppliers.length !== 1 ? 's' : ''}
            {' · '}
            {group.totalQty} items
            {group.totalCost !== null && (
              <>
                {' · '}
                <span className="font-medium text-foreground">{fmtCost(group.totalCost)}</span>
              </>
            )}
          </p>
        </div>
        <Link
          href={`/order/location/eta/${group.date}`}
          className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      {/* Supplier accordions */}
      <div className="divide-y divide-border/50">
        {group.suppliers.map((supplier) => {
          const key = `${group.date}:${supplier.supplierName}`;
          const isOpen = openSuppliers.has(key);
          return (
            <div key={supplier.supplierName}>
              <button
                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-muted/40"
                onClick={() => onToggle(key)}
              >
                <span className="truncate text-xs font-medium">{supplier.supplierName}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {fmtCost(supplier.totalCost)}
                  </span>
                  <ChevronDown
                    className={cn(
                      'size-3 shrink-0 text-muted-foreground transition-transform',
                      isOpen && 'rotate-180',
                    )}
                  />
                </div>
              </button>

              {isOpen && (
                <div className="px-3 pb-2 pt-0.5">
                  <table className="w-full">
                    <thead>
                      <tr className="text-[10px] text-muted-foreground">
                        <th className="pb-0.5 text-left font-medium">Item</th>
                        <th className="pb-0.5 text-right font-medium">Qty</th>
                        <th className="pb-0.5 text-right font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplier.items.map((item, idx) => (
                        <tr key={idx} className="border-t border-border/30 text-[11px]">
                          <td className="py-0.5 pr-2 leading-snug">
                            <span>{item.name}</span>
                            {item.note && (
                              <p className="mt-0.5 text-[10px] text-muted-foreground">{item.note}</p>
                            )}
                          </td>
                          <td className="py-0.5 pr-1 text-right tabular-nums align-top">{item.qty}</td>
                          <td className="py-0.5 text-right font-mono tabular-nums text-muted-foreground align-top">
                            {fmtCost(item.lineCost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-border text-[11px] font-medium">
                      <tr>
                        <td className="pt-1">Total</td>
                        <td className="pt-1 text-right tabular-nums">{supplier.totalQty}</td>
                        <td className="pt-1 text-right font-mono tabular-nums">
                          {fmtCost(supplier.totalCost)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
