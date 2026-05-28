'use client';

import { useState, useMemo, useTransition } from 'react';
import { getPoLineItems } from '../actions';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { ChevronDown, ChevronRight, Loader2, Package, Search } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { EtaOverview } from './EtaOverview';
import type {
  LocationOrderLineItem,
  LocationOrderSupplierGroup,
  FavoriteSupplier,
  SupplierGroupNav,
} from '../types';

type Props = {
  supplierGroups: LocationOrderSupplierGroup[];
  locationName: string;
  favoriteSuppliers: FavoriteSupplier[];
  supplierGroupsNav: SupplierGroupNav[];
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  unfulfilled: 'Unfulfilled',
  partially_fulfilled: 'Partially Filled',
  fulfilled: 'Fulfilled',
  completed: 'Completed',
};

type BadgeVariant =
  | 'amber'
  | 'blue'
  | 'purple'
  | 'green'
  | 'gray'
  | 'secondary';

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

export function LocationOrderView({
  supplierGroups,
  locationName,
  favoriteSuppliers,
  supplierGroupsNav,
}: Props) {
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(
    null,
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [navSearch, setNavSearch] = useState('');
  const [navSort, setNavSort] = useState<'count' | 'alpha'>('count');
  const [openPOs, setOpenPOs] = useState<Set<string>>(new Set());
  // null = loading in progress, array = loaded (possibly empty)
  const [lineItemsCache, setLineItemsCache] = useState<Map<string, LocationOrderLineItem[] | null>>(new Map());
  const [, startTransition] = useTransition();
  const [statusFilter, setStatusFilter] = useState('all');
  const [contentSearch, setContentSearch] = useState('');

  // groupId lookup map: supplierId → groupId (from favorites data only)
  const groupIdBySupplierId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const f of favoriteSuppliers) map.set(f.id, f.groupId);
    return map;
  }, [favoriteSuppliers]);

  // Nav list built exclusively from supplierGroups (only suppliers with actual orders).
  // Favorites data is used solely to look up groupId for filtering.
  // Entries are deduplicated by name to handle the case where multiple Supplier DB
  // records share the same company name (same-name groups are merged by count).
  const allNavSuppliers = useMemo(() => {
    const byName = new Map<
      string,
      { id: string; name: string; groupId: string | null; count: number }
    >();

    for (const g of supplierGroups) {
      const id = g.supplierId ?? '__unknown__';
      const name = g.supplierName;
      const groupId = g.supplierId
        ? (groupIdBySupplierId.get(g.supplierId) ?? null)
        : null;
      const count = g.purchaseOrders.length;

      const existing = byName.get(name);
      if (existing) {
        // Merge: keep the first id (nav click will show both groups in content)
        existing.count += count;
      } else {
        byName.set(name, { id, name, groupId, count });
      }
    }

    const entries = Array.from(byName.values());

    return entries
      .filter((s) => {
        const matchesGroup =
          selectedGroupId === null || s.groupId === selectedGroupId;
        const matchesSearch =
          !navSearch.trim() ||
          s.name.toLowerCase().includes(navSearch.toLowerCase());
        return matchesGroup && matchesSearch;
      })
      .sort((a, b) =>
        navSort === 'alpha'
          ? a.name.localeCompare(b.name)
          : b.count - a.count || a.name.localeCompare(b.name),
      );
  }, [supplierGroups, groupIdBySupplierId, selectedGroupId, navSearch, navSort]);

  // Supplier-filtered groups (respects nav selection, ignores status/content search).
  // Used for EtaOverview so the ETA summary always shows all ETAs for the selected supplier.
  const supplierFilteredGroups = useMemo(() => {
    if (selectedSupplierId === null) return supplierGroups;
    if (selectedSupplierId === '__unknown__') {
      return supplierGroups.filter((g) => g.supplierId === null);
    }
    const navEntry = allNavSuppliers.find((s) => s.id === selectedSupplierId);
    return navEntry
      ? supplierGroups.filter((g) => g.supplierName === navEntry.name)
      : supplierGroups.filter((g) => g.supplierId === selectedSupplierId);
  }, [supplierGroups, selectedSupplierId, allNavSuppliers]);

  // Right-panel content
  const visibleGroups = useMemo(() => {
    let base: typeof supplierGroups;
    if (selectedSupplierId === null) {
      base = supplierGroups;
    } else if (selectedSupplierId === '__unknown__') {
      base = supplierGroups.filter((g) => g.supplierId === null);
    } else {
      // Find the nav entry to get the display name, then match ALL groups with
      // that name — handles same-name suppliers merged in the nav.
      const navEntry = allNavSuppliers.find((s) => s.id === selectedSupplierId);
      base = navEntry
        ? supplierGroups.filter((g) => g.supplierName === navEntry.name)
        : supplierGroups.filter((g) => g.supplierId === selectedSupplierId);
    }

    return base
      .map((group) => ({
        ...group,
        purchaseOrders: group.purchaseOrders.filter((po) => {
          const matchesStatus =
            statusFilter === 'all' || po.status === statusFilter;
          const q = contentSearch.trim().toLowerCase();
          const matchesSearch =
            !q ||
            po.poNumber.toLowerCase().includes(q) ||
            po.shopifyOrderNames.some((n) => n.toLowerCase().includes(q)) ||
            po.lineItems.some((li) =>
              li.productTitle?.toLowerCase().includes(q),
            );
          return matchesStatus && matchesSearch;
        }),
      }))
      .filter((g) => g.purchaseOrders.length > 0);
  }, [supplierGroups, selectedSupplierId, statusFilter, contentSearch]);

  function togglePO(id: string, hasPreloadedItems: boolean) {
    const willOpen = !openPOs.has(id);
    setOpenPOs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    if (willOpen && !hasPreloadedItems && !lineItemsCache.has(id)) {
      setLineItemsCache((prev) => new Map(prev).set(id, null));
      startTransition(() => {
        void getPoLineItems(id).then((items) => {
          setLineItemsCache((prev) => new Map(prev).set(id, items));
        });
      });
    }
  }

  const totalPOs = supplierGroups.reduce(
    (sum, g) => sum + g.purchaseOrders.length,
    0,
  );

  const selectedSupplierName =
    selectedSupplierId === null
      ? 'All Suppliers'
      : (allNavSuppliers.find((s) => s.id === selectedSupplierId)?.name ?? 'Supplier');

  return (
    // Fixed height container — each column scrolls independently
    <div className="flex h-[calc(100dvh-10rem)] gap-0 overflow-hidden rounded-lg border border-border">
      {/* ── Left nav ── */}
      <div className="flex w-52 shrink-0 flex-col border-r border-border bg-muted/30">
        {/* Nav search */}
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Search suppliers…"
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Group filter chips */}
        {supplierGroupsNav.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-border p-2">
            <button
              onClick={() => setSelectedGroupId(null)}
              className={cn(
                'rounded-full px-2 py-0.5 text-xs transition-colors',
                selectedGroupId === null
                  ? 'bg-foreground text-background'
                  : 'border border-border text-muted-foreground hover:bg-muted',
              )}
            >
              All
            </button>
            {supplierGroupsNav.map((g) => (
              <button
                key={g.id}
                onClick={() =>
                  setSelectedGroupId(selectedGroupId === g.id ? null : g.id)
                }
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs transition-colors',
                  selectedGroupId === g.id
                    ? 'bg-foreground text-background'
                    : 'border border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}

        {/* Sort toggle */}
        <div className="flex gap-1 border-b border-border px-2 py-1.5">
          <button
            onClick={() => setNavSort('count')}
            className={cn(
              'flex-1 rounded px-2 py-1 text-xs transition-colors',
              navSort === 'count'
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            By orders
          </button>
          <button
            onClick={() => setNavSort('alpha')}
            className={cn(
              'flex-1 rounded px-2 py-1 text-xs transition-colors',
              navSort === 'alpha'
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            A → Z
          </button>
        </div>

        {/* Scrollable supplier list */}
        <div className="flex-1 overflow-y-auto p-2">
          <ul className="space-y-0.5">
            {/* All — hide when group or search is active */}
            {!navSearch && selectedGroupId === null && (
              <NavItem
                label="All"
                count={totalPOs}
                active={selectedSupplierId === null}
                onClick={() => setSelectedSupplierId(null)}
              />
            )}

            {allNavSuppliers.map((s) => (
              <NavItem
                key={s.id}
                label={s.name}
                count={s.count}
                active={selectedSupplierId === s.id}
                onClick={() =>
                  setSelectedSupplierId(
                    selectedSupplierId === s.id ? null : s.id,
                  )
                }
              />
            ))}

            {allNavSuppliers.length === 0 && (
              <li className="px-2 py-4 text-center text-xs text-muted-foreground">
                No suppliers found
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* ── Right content ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Content header + filters (fixed) */}
        <div className="shrink-0 space-y-3 border-b border-border px-5 py-3">
          <div>
            <h1 className="text-base font-semibold">{selectedSupplierName}</h1>
            <p className="text-xs text-muted-foreground">{locationName}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="h-7 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Search PO, order, or item…"
              value={contentSearch}
              onChange={(e) => setContentSearch(e.target.value)}
            />
            <div className="flex flex-wrap gap-1">
              {(
                [
                  'all',
                  'unfulfilled',
                  'partially_fulfilled',
                  'fulfilled',
                  'completed',
                ] as const
              ).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    'h-6 rounded-full px-2.5 text-xs transition-colors',
                    statusFilter === s
                      ? 'bg-foreground text-background'
                      : 'border border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  {s === 'all' ? 'All' : STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Scrollable order list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {selectedSupplierId === null && (
            <EtaOverview supplierGroups={supplierGroups} />
          )}

          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Order History
          </p>

          {visibleGroups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <Package className="size-10 opacity-40" />
              <p className="text-sm">No orders found</p>
            </div>
          ) : (
            <div className="space-y-5">
              {visibleGroups.map((group) => (
                <div key={group.supplierId ?? group.supplierName}>
                  {selectedSupplierId === null && (
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.supplierName}
                    </p>
                  )}
                  <div className="rounded-lg border border-border bg-card">
                    {group.purchaseOrders.map((po) => {
                      const poOpen = openPOs.has(po.id);
                      const hasPreloadedItems = po.lineItems.length > 0;
                      const lazyItems = lineItemsCache.get(po.id);
                      // null = loading, array = loaded, undefined = not yet fetched
                      const lineItems: LocationOrderLineItem[] | null =
                        hasPreloadedItems ? po.lineItems : (lazyItems ?? null);
                      const badgeVariant: BadgeVariant =
                        STATUS_BADGE[po.status] ?? 'secondary';
                      return (
                        <div
                          key={po.id}
                          className="border-b border-border last:border-0"
                        >
                          <button
                            className="flex w-full items-center gap-6 px-4 py-2.5 text-left hover:bg-muted/40"
                            onClick={() => togglePO(po.id, hasPreloadedItems)}
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
                            <div className="flex shrink-0 gap-4">
                              <DateCell label="Ordered" value={po.orderedAt} />
                              <DateCell
                                label="PO Created"
                                value={po.dateCreated}
                              />
                              <DateCell label="ETA" value={po.expectedDate} />
                            </div>
                          </button>

                          {poOpen && (
                            <div className="bg-muted/20 px-4 pb-2 pt-1">
                              {po.comment && (
                                <p className="mb-2 text-xs text-muted-foreground">{po.comment}</p>
                              )}
                              {lineItems === null ? (
                                <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                                  <Loader2 className="size-3.5 animate-spin" />
                                  Loading…
                                </div>
                              ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-border text-muted-foreground">
                                    <th className="py-1 text-left font-medium">
                                      Item
                                    </th>
                                    <th className="py-1 text-left font-medium">
                                      SKU
                                    </th>
                                    <th className="py-1 text-right font-medium">
                                      Qty
                                    </th>
                                    <th className="py-1 text-right font-medium">
                                      Unit Price
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lineItems.map((li) => (
                                    <tr
                                      key={li.id}
                                      className="border-b border-border/50 last:border-0"
                                    >
                                      <td className="py-1.5 pr-4">
                                        <span className="font-medium">
                                          {li.productTitle ?? '(untitled)'}
                                        </span>
                                        {li.variantTitle &&
                                          li.variantTitle.toLowerCase() !==
                                            'default title' && (
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
                                      <td className="py-1.5 pr-2 text-right">
                                        {li.quantity}
                                      </td>
                                      <td className="py-1.5 text-right font-mono text-muted-foreground">
                                        {li.itemPrice
                                          ? `$${li.itemPrice}`
                                          : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              )}
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
      </div>
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

function NavItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors',
          active
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <span className="truncate">{label}</span>
        {count > 0 && (
          <span className="ml-2 shrink-0 text-xs tabular-nums">{count}</span>
        )}
      </button>
    </li>
  );
}
