'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { YmdDateInput } from '@/components/ui/ymd-date-input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import { OFFICE_TABLE_VIEW_FETCH_LIMIT } from '../constants/office-table-view';
import { formatOfficeDateFromDate } from '../utils/format-date-label';
import type {
  OfficePoTableLineItem,
  OfficeShopifyTableLineItem,
  OfficeTableViewLinkedPo,
  OfficeTableViewPoRow,
  OfficeTableViewShopifyRow,
} from '../types/office-table-view';
import { OfficeOrderLineItemsDialog } from './OfficeOrderLineItemsDialog';
import { PoEmailSentProgress } from './PoEmailSentProgress';
import { ShopifyOrderMemoPopover } from './ShopifyOrderMemoPopover';

type TableTab = 'shopify' | 'po';

export type OfficeTableFilterOption = { id: string; label: string };

const PAGE_SIZE = 25;

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${formatOfficeDateFromDate(d)} ${d.toLocaleTimeString('en-CA', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Vancouver',
    })}`;
  } catch {
    return '—';
  }
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return formatOfficeDateFromDate(d);
  } catch {
    return iso.slice(0, 10);
  }
}

const th =
  'text-left text-xs font-medium text-muted-foreground uppercase tracking-wide px-2 py-2 border-b bg-muted/50';
const td = 'px-2 py-1.5 text-sm border-b align-top';

function TablePaginationBar({
  page,
  pageCount,
  total,
  loaded,
  loading,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  loaded: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const loadedHint =
    loaded < total ? ` · ${loaded.toLocaleString()} loaded` : '';
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t bg-muted/20 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground tabular-nums">
          {total === 0
            ? 'No rows'
            : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}${loadedHint}`}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          {loading ? (
            <Spinner className="size-5 shrink-0 text-muted-foreground" />
          ) : (
            <span className="min-w-[4.5rem] text-center tabular-nums text-muted-foreground">
              {page} / {pageCount}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={page >= pageCount || loading}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function ShopifyPoLinksCell({
  linked,
  onSelectPo,
}: {
  linked: OfficeTableViewLinkedPo[];
  onSelectPo: (poId: string) => void;
}) {
  if (linked.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto gap-1 px-1.5 py-0.5 text-xs font-medium text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          {linked.length} POs
          <ChevronDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[10rem]">
        <DropdownMenuLabel className="text-xs">Open PO</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {linked.map((p) => (
          <DropdownMenuItem
            key={p.id}
            className="cursor-pointer text-sm"
            onSelect={() => onSelectPo(p.id)}
          >
            {p.poNumber}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabCount({ active, n }: { active: boolean; n: number }) {
  return (
    <span
      className={cn(
        'text-[10px] font-medium px-1.5 py-px rounded-full',
        active
          ? 'bg-[#FAEEDA] text-[#633806]'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {n.toLocaleString()}
    </span>
  );
}

export function OfficeTableSplitView({
  shopifyAdminStoreHandle,
  shopifyCreateOrderEnabled = false,
  onRequestCreateShopifyOrder,
  initialShopifyRows,
  initialPoRows,
  shopifyTotal,
  poTotal,
  customerFilterOptions,
  supplierFilterOptions,
  supplierGroupFilterOptions = [],
  onOpenPoDetail,
}: {
  shopifyAdminStoreHandle?: string | null;
  shopifyCreateOrderEnabled?: boolean;
  onRequestCreateShopifyOrder?: () => void;
  initialShopifyRows?: OfficeTableViewShopifyRow[];
  initialPoRows?: OfficeTableViewPoRow[];
  shopifyTotal?: number;
  poTotal?: number;
  customerFilterOptions: OfficeTableFilterOption[];
  supplierFilterOptions: OfficeTableFilterOption[];
  /** `id` = `SupplierGroup.slug` */
  supplierGroupFilterOptions?: OfficeTableFilterOption[];
  onOpenPoDetail: (purchaseOrderId: string) => void | Promise<void>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TableTab>('shopify');
  const [shopifyRows, setShopifyRows] = useState<OfficeTableViewShopifyRow[]>(initialShopifyRows ?? []);
  const [poRows, setPoRows] = useState<OfficeTableViewPoRow[]>(initialPoRows ?? []);
  const [shopifyPage, setShopifyPage] = useState(1);
  const [poPage, setPoPage] = useState(1);
  const [shopifyLoading, setShopifyLoading] = useState(!initialShopifyRows);
  const [poLoading, setPoLoading] = useState(false);

  const [qInput, setQInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [supplierGroupSlug, setSupplierGroupSlug] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [poDateField, setPoDateField] = useState<'created' | 'expected'>(
    'created',
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(qInput), 400);
    return () => clearTimeout(t);
  }, [qInput]);

  const filtersActive = useMemo(
    () =>
      Boolean(
        debouncedQ.trim() ||
        customerId ||
        supplierId ||
        supplierGroupSlug ||
        dateFrom ||
        dateTo,
      ),
    [debouncedQ, customerId, supplierId, supplierGroupSlug, dateFrom, dateTo],
  );

  const [shopifyDisplayTotal, setShopifyDisplayTotal] = useState(shopifyTotal ?? 0);
  const [poDisplayTotal, setPoDisplayTotal] = useState(poTotal ?? 0);

  const shopifyRowsRef = useRef(shopifyRows);
  const poRowsRef = useRef(poRows);
  shopifyRowsRef.current = shopifyRows;
  poRowsRef.current = poRows;

  const shopifyInFlight = useRef(false);
  const poInFlight = useRef(false);
  /** Empty API page — stop auto-fetch / hide load-more (avoids infinite retry). */
  const [shopifyNoMore, setShopifyNoMore] = useState(false);
  const [poNoMore, setPoNoMore] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const [selectedShopifyOrderIds, setSelectedShopifyOrderIds] = useState(
    () => new Set<string>(),
  );
  const [archivingShopifySelection, setArchivingShopifySelection] =
    useState(false);
  const shopifyHeaderCheckboxRef = useRef<HTMLInputElement>(null);

  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [linePreview, setLinePreview] = useState<{
    kind: 'shopify' | 'po';
    id: string;
    title: string;
    subtitle: string;
  } | null>(null);
  const [lineLoading, setLineLoading] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);
  const [lineDialogCurrency, setLineDialogCurrency] = useState('USD');
  const [shopifyDialogLines, setShopifyDialogLines] = useState<
    OfficeShopifyTableLineItem[]
  >([]);
  const [poDialogLines, setPoDialogLines] = useState<OfficePoTableLineItem[]>(
    [],
  );

  const buildShopifyQueryString = useCallback(
    (offset: number) => {
      const p = new URLSearchParams({
        offset: String(offset),
        limit: String(OFFICE_TABLE_VIEW_FETCH_LIMIT),
      });
      const q = debouncedQ.trim();
      if (q) p.set('q', q);
      if (customerId) p.set('customerId', customerId);
      if (supplierId) p.set('supplierId', supplierId);
      if (supplierGroupSlug) p.set('supplierGroupSlug', supplierGroupSlug);
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo) p.set('dateTo', dateTo);
      return p.toString();
    },
    [debouncedQ, customerId, supplierId, supplierGroupSlug, dateFrom, dateTo],
  );

  const buildPoQueryString = useCallback(
    (offset: number) => {
      const p = new URLSearchParams({
        offset: String(offset),
        limit: String(OFFICE_TABLE_VIEW_FETCH_LIMIT),
        poDateField,
      });
      const q = debouncedQ.trim();
      if (q) p.set('q', q);
      if (customerId) p.set('customerId', customerId);
      if (supplierId) p.set('supplierId', supplierId);
      if (supplierGroupSlug) p.set('supplierGroupSlug', supplierGroupSlug);
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo) p.set('dateTo', dateTo);
      return p.toString();
    },
    [
      debouncedQ,
      customerId,
      supplierId,
      supplierGroupSlug,
      dateFrom,
      dateTo,
      poDateField,
    ],
  );

  // Initial fetch when no server-provided data (lazy table view pattern).
  useEffect(() => {
    if (initialShopifyRows !== undefined) return;
    const ac = new AbortController();
    (async () => {
      setShopifyLoading(true);
      try {
        const qs = new URLSearchParams({ offset: '0', limit: String(OFFICE_TABLE_VIEW_FETCH_LIMIT) });
        const [shopifyRes, poRes] = await Promise.all([
          fetch(`/api/shopify/table-view?${qs}`, { signal: ac.signal }),
          fetch(`/api/order/table-view/po?${qs}`, { signal: ac.signal }),
        ]);
        if (ac.signal.aborted) return;
        type ShopifyBody = { rows?: OfficeTableViewShopifyRow[]; total?: number };
        type PoBody = { rows?: OfficeTableViewPoRow[]; total?: number };
        const [shopifyBody, poBody] = await Promise.all([
          shopifyRes.ok ? shopifyRes.json() as Promise<ShopifyBody> : Promise.resolve<ShopifyBody>({}),
          poRes.ok ? poRes.json() as Promise<PoBody> : Promise.resolve<PoBody>({}),
        ]);
        if (ac.signal.aborted) return;
        const sRows = shopifyBody.rows ?? [];
        const pRows = poBody.rows ?? [];
        const sTotal = shopifyBody.total ?? 0;
        const pTotal = poBody.total ?? 0;
        setShopifyRows(sRows);
        setShopifyDisplayTotal(sTotal);
        setShopifyNoMore(sRows.length === 0 || sRows.length >= sTotal);
        setPoRows(pRows);
        setPoDisplayTotal(pTotal);
        setPoNoMore(pRows.length === 0 || pRows.length >= pTotal);
      } finally {
        if (!ac.signal.aborted) setShopifyLoading(false);
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (filtersActive || initialShopifyRows === undefined) return;
    setShopifyRows(initialShopifyRows);
    setShopifyDisplayTotal(shopifyTotal ?? 0);
    setShopifyNoMore(false);
    setShopifyPage(1);
  }, [initialShopifyRows, shopifyTotal, filtersActive]);

  useEffect(() => {
    if (filtersActive || initialPoRows === undefined) return;
    setPoRows(initialPoRows);
    setPoDisplayTotal(poTotal ?? 0);
    setPoNoMore(false);
    setPoPage(1);
  }, [initialPoRows, poTotal, filtersActive]);

  useEffect(() => {
    if (tab !== 'shopify' || !filtersActive) return;
    const ac = new AbortController();
    (async () => {
      setShopifyLoading(true);
      try {
        const res = await fetch(
          `/api/shopify/table-view?${buildShopifyQueryString(0)}`,
          { signal: ac.signal },
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          rows?: OfficeTableViewShopifyRow[];
          total?: number;
        };
        if (ac.signal.aborted) return;
        const rows = body.rows ?? [];
        const total = body.total ?? 0;
        setShopifyRows(rows);
        setShopifyDisplayTotal(total);
        setShopifyPage(1);
        setShopifyNoMore(rows.length === 0 || rows.length >= total);
      } finally {
        if (!ac.signal.aborted) setShopifyLoading(false);
      }
    })();
    return () => ac.abort();
  }, [tab, filtersActive, buildShopifyQueryString]);

  useEffect(() => {
    if (tab !== 'po' || !filtersActive) return;
    const ac = new AbortController();
    (async () => {
      setPoLoading(true);
      try {
        const res = await fetch(
          `/api/order/table-view/po?${buildPoQueryString(0)}`,
          { signal: ac.signal },
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          rows?: OfficeTableViewPoRow[];
          total?: number;
        };
        if (ac.signal.aborted) return;
        const rows = body.rows ?? [];
        const total = body.total ?? 0;
        setPoRows(rows);
        setPoDisplayTotal(total);
        setPoPage(1);
        setPoNoMore(rows.length === 0 || rows.length >= total);
      } finally {
        if (!ac.signal.aborted) setPoLoading(false);
      }
    })();
    return () => ac.abort();
  }, [tab, filtersActive, buildPoQueryString]);

  const shopifyPageCount = useMemo(
    () => Math.max(1, Math.ceil(shopifyDisplayTotal / PAGE_SIZE)),
    [shopifyDisplayTotal],
  );
  const poPageCount = useMemo(
    () => Math.max(1, Math.ceil(poDisplayTotal / PAGE_SIZE)),
    [poDisplayTotal],
  );

  useEffect(() => {
    setShopifyPage((p) => Math.min(Math.max(1, p), shopifyPageCount));
  }, [shopifyPageCount]);

  useEffect(() => {
    setPoPage((p) => Math.min(Math.max(1, p), poPageCount));
  }, [poPageCount]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab, shopifyPage, poPage]);

  useEffect(() => {
    if (!lineDialogOpen || !linePreview) return;
    const ac = new AbortController();
    (async () => {
      setLineLoading(true);
      setLineError(null);
      setShopifyDialogLines([]);
      setPoDialogLines([]);
      try {
        if (linePreview.kind === 'shopify') {
          const res = await fetch(
            `/api/shopify/table-view/${linePreview.id}/line-items`,
            { signal: ac.signal },
          );
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            lines?: OfficeShopifyTableLineItem[];
            currencyCode?: string;
          };
          if (ac.signal.aborted) return;
          if (!res.ok) {
            setLineError(
              typeof data.error === 'string'
                ? data.error
                : 'Failed to load lines',
            );
            return;
          }
          setShopifyDialogLines(Array.isArray(data.lines) ? data.lines : []);
          setLineDialogCurrency(
            typeof data.currencyCode === 'string' && data.currencyCode.trim()
              ? data.currencyCode.trim()
              : 'USD',
          );
        } else {
          const res = await fetch(
            `/api/order/table-view/po/${linePreview.id}/line-items`,
            { signal: ac.signal },
          );
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            lines?: OfficePoTableLineItem[];
            currency?: string;
          };
          if (ac.signal.aborted) return;
          if (!res.ok) {
            setLineError(
              typeof data.error === 'string'
                ? data.error
                : 'Failed to load lines',
            );
            return;
          }
          setPoDialogLines(Array.isArray(data.lines) ? data.lines : []);
          setLineDialogCurrency(
            typeof data.currency === 'string' && data.currency.trim()
              ? data.currency.trim()
              : 'USD',
          );
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          setLineError(e instanceof Error ? e.message : 'Failed to load lines');
        }
      } finally {
        if (!ac.signal.aborted) setLineLoading(false);
      }
    })();
    return () => ac.abort();
  }, [lineDialogOpen, linePreview]);

  const openShopifyLineDialog = useCallback((r: OfficeTableViewShopifyRow) => {
    if (r.lineItemCount <= 0) return;
    setLinePreview({
      kind: 'shopify',
      id: r.id,
      title: `${r.orderLabel} — line items`,
      subtitle: r.customerLabel,
    });
    setLineDialogOpen(true);
  }, []);

  const openPoLineDialog = useCallback((r: OfficeTableViewPoRow) => {
    if (r.lineItemCount <= 0) return;
    setLinePreview({
      kind: 'po',
      id: r.id,
      title: `${r.poNumber} — line items`,
      subtitle: r.supplierCompany,
    });
    setLineDialogOpen(true);
  }, []);

  const handleLineDialogOpenChange = useCallback((open: boolean) => {
    setLineDialogOpen(open);
    if (!open) {
      setLinePreview(null);
      setLineError(null);
      setShopifyDialogLines([]);
      setPoDialogLines([]);
    }
  }, []);

  const fetchMoreShopify = useCallback(async () => {
    if (shopifyInFlight.current || shopifyNoMore) return;
    const offset = shopifyRowsRef.current.length;
    if (offset >= shopifyDisplayTotal) return;
    shopifyInFlight.current = true;
    setShopifyLoading(true);
    try {
      const res = await fetch(
        `/api/shopify/table-view?${buildShopifyQueryString(offset)}`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as {
        rows?: OfficeTableViewShopifyRow[];
        total?: number;
      };
      const rows = body.rows ?? [];
      const total = body.total ?? shopifyDisplayTotal;
      if (rows.length === 0) {
        setShopifyNoMore(true);
        return;
      }
      const nextLen = offset + rows.length;
      setShopifyDisplayTotal(total);
      setShopifyNoMore(
        nextLen >= total || rows.length < OFFICE_TABLE_VIEW_FETCH_LIMIT,
      );
      setShopifyRows((prev) => [...prev, ...rows]);
    } finally {
      shopifyInFlight.current = false;
      setShopifyLoading(false);
    }
  }, [shopifyDisplayTotal, shopifyNoMore, buildShopifyQueryString]);

  const fetchMorePo = useCallback(async () => {
    if (poInFlight.current || poNoMore) return;
    const offset = poRowsRef.current.length;
    if (offset >= poDisplayTotal) return;
    poInFlight.current = true;
    setPoLoading(true);
    try {
      const res = await fetch(
        `/api/order/table-view/po?${buildPoQueryString(offset)}`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as {
        rows?: OfficeTableViewPoRow[];
        total?: number;
      };
      const rows = body.rows ?? [];
      const total = body.total ?? poDisplayTotal;
      if (rows.length === 0) {
        setPoNoMore(true);
        return;
      }
      const nextLen = offset + rows.length;
      setPoDisplayTotal(total);
      setPoNoMore(
        nextLen >= total || rows.length < OFFICE_TABLE_VIEW_FETCH_LIMIT,
      );
      setPoRows((prev) => [...prev, ...rows]);
    } finally {
      poInFlight.current = false;
      setPoLoading(false);
    }
  }, [poDisplayTotal, poNoMore, buildPoQueryString]);

  useEffect(() => {
    if (tab !== 'shopify' || shopifyNoMore) return;
    const needed = Math.min(shopifyPage * PAGE_SIZE, shopifyDisplayTotal);
    if (
      shopifyRows.length >= needed ||
      shopifyRows.length >= shopifyDisplayTotal
    )
      return;
    void fetchMoreShopify();
  }, [
    tab,
    shopifyPage,
    shopifyRows.length,
    shopifyDisplayTotal,
    shopifyNoMore,
    fetchMoreShopify,
  ]);

  useEffect(() => {
    if (tab !== 'po' || poNoMore) return;
    const needed = Math.min(poPage * PAGE_SIZE, poDisplayTotal);
    if (poRows.length >= needed || poRows.length >= poDisplayTotal) return;
    void fetchMorePo();
  }, [tab, poPage, poRows.length, poDisplayTotal, poNoMore, fetchMorePo]);

  const shopifySlice = useMemo(() => {
    const start = (shopifyPage - 1) * PAGE_SIZE;
    return shopifyRows.slice(start, start + PAGE_SIZE);
  }, [shopifyRows, shopifyPage]);

  const poSlice = useMemo(() => {
    const start = (poPage - 1) * PAGE_SIZE;
    return poRows.slice(start, start + PAGE_SIZE);
  }, [poRows, poPage]);

  useEffect(() => {
    if (tab !== 'shopify') setSelectedShopifyOrderIds(new Set());
  }, [tab]);

  const pageSelectableShopifyIds = useMemo(
    () => shopifySlice.filter((r) => !r.archived).map((r) => r.id),
    [shopifySlice],
  );

  const allPageSelectableShopifySelected =
    pageSelectableShopifyIds.length > 0 &&
    pageSelectableShopifyIds.every((id) => selectedShopifyOrderIds.has(id));

  useLayoutEffect(() => {
    const el = shopifyHeaderCheckboxRef.current;
    if (!el) return;
    const somePartial =
      !allPageSelectableShopifySelected &&
      pageSelectableShopifyIds.some((id) => selectedShopifyOrderIds.has(id));
    el.indeterminate = somePartial;
  }, [
    allPageSelectableShopifySelected,
    pageSelectableShopifyIds,
    selectedShopifyOrderIds,
  ]);

  const toggleShopifySelectPage = useCallback(() => {
    setSelectedShopifyOrderIds((prev) => {
      const next = new Set(prev);
      const pageIds = pageSelectableShopifyIds;
      if (pageIds.length > 0 && pageIds.every((id) => next.has(id))) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }, [pageSelectableShopifyIds]);

  const toggleShopifySelectRow = useCallback(
    (id: string, archived: boolean) => {
      if (archived) return;
      setSelectedShopifyOrderIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [],
  );

  const selectedArchivableShopifyIds = useMemo(() => {
    return [...selectedShopifyOrderIds].filter((id) => {
      const row = shopifyRows.find((r) => r.id === id);
      if (!row) return true;
      return !row.archived;
    });
  }, [selectedShopifyOrderIds, shopifyRows]);

  const handleArchiveSelectedShopifyOrders = useCallback(async () => {
    const ids = selectedArchivableShopifyIds;
    if (ids.length === 0) {
      toast.error('Select at least one order that is not already archived.');
      return;
    }
    const idSet = new Set(ids);
    const rowsSnapshot = shopifyRows.map((r) => ({ ...r }));
    const selectionSnapshot = new Set(selectedShopifyOrderIds);

    setShopifyRows((prev) =>
      prev.map((r) => (idSet.has(r.id) ? { ...r, archived: true } : r)),
    );
    setSelectedShopifyOrderIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });

    setArchivingShopifySelection(true);
    try {
      const res = await fetch('/api/order/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopifyOrderIds: ids, archive: true }),
      });
      if (!res.ok)
        throw new Error(await res.text().catch(() => res.statusText));
      toast.success(
        ids.length === 1 ? 'Order archived.' : `${ids.length} orders archived.`,
      );
      router.refresh();
    } catch (e) {
      setShopifyRows(rowsSnapshot);
      setSelectedShopifyOrderIds(selectionSnapshot);
      toast.error(e instanceof Error ? e.message : 'Archive failed.');
    } finally {
      setArchivingShopifySelection(false);
    }
  }, [router, selectedArchivableShopifyIds, shopifyRows, selectedShopifyOrderIds]);

  const shopifyGap =
    tab === 'shopify' &&
    shopifySlice.length < PAGE_SIZE &&
    shopifyRows.length < shopifyDisplayTotal &&
    shopifyLoading;

  const poGap =
    tab === 'po' &&
    poSlice.length < PAGE_SIZE &&
    poRows.length < poDisplayTotal &&
    poLoading;

  const clearFilters = useCallback(() => {
    setQInput('');
    setDebouncedQ('');
    setCustomerId('');
    setSupplierId('');
    setSupplierGroupSlug('');
    setDateFrom('');
    setDateTo('');
    setPoDateField('created');
    setSelectedShopifyOrderIds(new Set());
  }, []);

  const selectCls =
    'h-9 max-w-full min-w-0 rounded-md border border-input bg-white px-2 text-sm shadow-xs dark:bg-input/30';

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center overflow-x-auto border-b bg-background">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setTab('shopify')}
          className={cn(
            'h-10 gap-1.5 rounded-none px-3.5 text-[12px] font-normal -mb-px border-b-2 hover:bg-transparent',
            tab === 'shopify'
              ? 'border-foreground font-medium text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          Shopify
          <TabCount active={tab === 'shopify'} n={shopifyTotal ?? shopifyDisplayTotal} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setTab('po')}
          className={cn(
            'h-10 gap-1.5 rounded-none px-3.5 text-[12px] font-normal -mb-px border-b-2 hover:bg-transparent',
            tab === 'po'
              ? 'border-foreground font-medium text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          PO
          <TabCount active={tab === 'po'} n={poTotal ?? poDisplayTotal} />
        </Button>
      </div>

      <p className="shrink-0 border-b bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
        Newest first
        {tab === 'shopify' ? ' — Shopify orders' : ' — Purchase orders'}
        {filtersActive ? (
          <span className="ml-2 text-foreground/80">
            ·{' '}
            {tab === 'shopify'
              ? shopifyDisplayTotal.toLocaleString()
              : poDisplayTotal.toLocaleString()}{' '}
            {tab === 'shopify'
              ? shopifyDisplayTotal === 1
                ? 'order'
                : 'orders'
              : poDisplayTotal === 1
                ? 'PO'
                : 'POs'}{' '}
            after filter
          </span>
        ) : null}
      </p>

      <div className="shrink-0 space-y-2 border-b bg-background px-3 py-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-[12rem] max-w-[20rem] flex-1 flex-col gap-1">
            <label
              htmlFor="office-table-q"
              className="text-[11px] font-medium text-muted-foreground"
            >
              Search
            </label>
            <Input
              id="office-table-q"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Order #, PO #, SKU, item, supplier…"
              className="h-9 text-sm"
            />
          </div>
          <div className="flex min-w-[9rem] max-w-[14rem] flex-col gap-1">
            <label
              htmlFor="office-table-customer"
              className="text-[11px] font-medium text-muted-foreground"
            >
              Customer
            </label>
            <SearchableSelect
              id="office-table-customer"
              options={customerFilterOptions}
              value={customerId}
              onValueChange={setCustomerId}
              allLabel="All"
              searchPlaceholder="Filter customers…"
            />
          </div>
          <div className="flex min-w-[9rem] max-w-[14rem] flex-col gap-1">
            <label
              htmlFor="office-table-supplier"
              className="text-[11px] font-medium text-muted-foreground"
            >
              Supplier
            </label>
            <SearchableSelect
              id="office-table-supplier"
              options={supplierFilterOptions}
              value={supplierId}
              onValueChange={setSupplierId}
              allLabel="All"
              searchPlaceholder="Filter suppliers…"
            />
          </div>
          {supplierGroupFilterOptions.length > 0 ? (
            <div className="flex min-w-[9rem] max-w-[14rem] flex-col gap-1">
              <label
                htmlFor="office-table-supplier-group"
                className="text-[11px] font-medium text-muted-foreground"
              >
                Supplier group
              </label>
              <select
                id="office-table-supplier-group"
                className={selectCls}
                value={supplierGroupSlug}
                onChange={(e) => setSupplierGroupSlug(e.target.value)}
              >
                <option value="">All</option>
                {supplierGroupFilterOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              From
            </span>
            <YmdDateInput
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 min-w-[12rem] text-sm tabular-nums"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              To
            </span>
            <YmdDateInput
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 min-w-[12rem] text-sm tabular-nums"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 text-xs"
            disabled={
              !qInput.trim() &&
              !customerId &&
              !supplierId &&
              !supplierGroupSlug &&
              !dateFrom &&
              !dateTo &&
              (tab !== 'po' || poDateField === 'created')
            }
            onClick={clearFilters}
          >
            Clear
          </Button>
        </div>
        {tab === 'po' ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">PO date range uses</span>
            <div className="inline-flex rounded-md border border-input bg-muted/30 p-0.5">
              <Button
                type="button"
                variant={poDateField === 'created' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPoDateField('created')}
              >
                Created
              </Button>
              <Button
                type="button"
                variant={poDateField === 'expected' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPoDateField('expected')}
              >
                Expected delivery
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {tab === 'shopify' ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/15 px-3 py-2">
          <span className="text-[11px] text-muted-foreground">
            {selectedArchivableShopifyIds.length > 0
              ? `${selectedArchivableShopifyIds.length} selected`
              : 'Select orders to archive'}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {shopifyCreateOrderEnabled && onRequestCreateShopifyOrder ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={onRequestCreateShopifyOrder}
              >
                New Shopify order
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 text-xs"
              disabled={
                archivingShopifySelection ||
                selectedArchivableShopifyIds.length === 0
              }
              onClick={() => void handleArchiveSelectedShopifyOrders()}
            >
              {archivingShopifySelection
                ? 'Archiving…'
                : `Archive selected${
                    selectedArchivableShopifyIds.length > 0
                      ? ` (${selectedArchivableShopifyIds.length})`
                      : ''
                  }`}
            </Button>
          </div>
        </div>
      ) : null}

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        {(tab === 'shopify' && shopifyLoading) ||
        (tab === 'po' && poLoading) ? (
          <div
            className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center bg-background/50"
            aria-busy
            aria-label="Loading"
          >
            <Spinner className="size-8 text-muted-foreground" />
          </div>
        ) : null}
        {tab === 'shopify' ? (
          <table className="w-full border-collapse table-fixed">
            <colgroup>
              <col className="w-[2.25rem]" />
              <col className="w-[9%]" />
              <col className="w-[17%]" />
              <col className="w-[2.75rem]" />
              <col className="w-[15%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[8%]" />
              <col className="w-[17%]" />
            </colgroup>
            <thead className="sticky top-0 z-[1]">
              <tr>
                <th className={`${th} w-9 text-center`}>
                  <span className="sr-only">Select</span>
                  <input
                    ref={shopifyHeaderCheckboxRef}
                    type="checkbox"
                    className="size-3.5 rounded border border-input align-middle"
                    checked={allPageSelectableShopifySelected}
                    onChange={toggleShopifySelectPage}
                    disabled={pageSelectableShopifyIds.length === 0}
                    aria-label="Select all orders on this page"
                  />
                </th>
                <th className={th}>Order</th>
                <th className={th}>Customer</th>
                <th className={`${th} text-center`}>Memo</th>
                <th className={th}>Created</th>
                <th className={th}>Fulfill</th>
                <th className={th}>Pay</th>
                <th className={th}>Lines</th>
                <th className={th}>Linked POs</th>
              </tr>
            </thead>
            <tbody>
              {shopifySlice.map((r) => (
                <tr
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    r.archived
                      ? 'bg-muted/40 text-muted-foreground'
                      : undefined,
                    r.shopifyAdminOrderUrl
                      ? 'cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none'
                      : undefined,
                  )}
                  onClick={() => {
                    if (!r.shopifyAdminOrderUrl) return;
                    window.open(
                      r.shopifyAdminOrderUrl,
                      '_blank',
                      'noopener,noreferrer',
                    );
                  }}
                  onKeyDown={(e) => {
                    if (!r.shopifyAdminOrderUrl) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      window.open(
                        r.shopifyAdminOrderUrl,
                        '_blank',
                        'noopener,noreferrer',
                      );
                    }
                  }}
                >
                  <td
                    className={`${td} w-9 text-left align-middle`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 rounded border border-input"
                      checked={selectedShopifyOrderIds.has(r.id)}
                      disabled={r.archived}
                      onChange={() => toggleShopifySelectRow(r.id, r.archived)}
                      aria-label={`Select order ${r.orderLabel}`}
                    />
                  </td>
                  <td className={td}>
                    <span className="font-mono tabular-nums">
                      {r.orderLabel}
                    </span>
                    {r.archived ? (
                      <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                        archived
                      </span>
                    ) : null}
                  </td>
                  <td className={`${td} break-words`}>{r.customerLabel}</td>
                  <td
                    className={`${td} text-center align-middle`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.orderMemo ? (
                      <div className="flex justify-center">
                        <ShopifyOrderMemoPopover
                          memo={r.orderMemo}
                          stopRowClick
                        />
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    {formatDateTime(r.shopifyCreatedAt)}
                  </td>
                  <td className={`${td} text-xs`}>
                    {r.displayFulfillmentStatus ?? '—'}
                  </td>
                  <td className={`${td} text-xs`}>
                    {r.displayFinancialStatus ?? '—'}
                  </td>
                  <td className={td} onClick={(e) => e.stopPropagation()}>
                    {r.lineItemCount > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto min-h-0 px-1.5 py-0.5 text-xs font-medium tabular-nums text-primary underline-offset-2 hover:underline"
                        onClick={() => openShopifyLineDialog(r)}
                      >
                        {r.lineItemCount}
                      </Button>
                    ) : (
                      <span className="tabular-nums text-muted-foreground">
                        0
                      </span>
                    )}
                  </td>
                  <td className={td} onClick={(e) => e.stopPropagation()}>
                    <ShopifyPoLinksCell
                      linked={r.linkedPurchaseOrders}
                      onSelectPo={onOpenPoDetail}
                    />
                  </td>
                </tr>
              ))}
              {shopifyGap ? (
                <tr>
                  <td
                    colSpan={9}
                    className="py-12 text-center align-middle text-muted-foreground"
                  >
                    <Spinner className="mx-auto size-6" />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse table-fixed">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[11%]" />
              <col className="w-[7%]" />
              <col className="w-[11%]" />
              <col className="w-[12%]" />
              <col className="w-[8%]" />
              <col className="w-[13%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
            </colgroup>
            <thead className="sticky top-0 z-[1]">
              <tr>
                <th className={th}>PO #</th>
                <th className={th}>Supplier</th>
                <th className={th}>Status</th>
                <th className={th}>Created</th>
                <th className={th}>Created by</th>
                <th className={th}>Expected</th>
                <th className={th}>Email delivered</th>
                <th className={th}>Lines</th>
                <th className={th}>Orders</th>
              </tr>
            </thead>
            <tbody>
              {poSlice.map((r) => (
                <tr
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    r.archived
                      ? 'bg-muted/40 text-muted-foreground'
                      : undefined,
                    'cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none',
                  )}
                  onClick={() => void onOpenPoDetail(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void onOpenPoDetail(r.id);
                    }
                  }}
                >
                  <td className={td}>
                    <span className="font-medium">{r.poNumber}</span>
                    {r.archived ? (
                      <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                        archived
                      </span>
                    ) : null}
                  </td>
                  <td className={`${td} break-words`}>{r.supplierCompany}</td>
                  <td className={`${td} text-xs`}>{r.status}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td className={`${td} break-words text-xs`}>
                    {r.createdByLabel}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    {formatDateOnly(r.expectedDate)}
                  </td>
                  <td className={`${td} whitespace-nowrap text-xs`}>
                    {!r.poEmailTracked ? (
                      <span className="text-muted-foreground">—</span>
                    ) : r.emailDeliveryWaivedAt ? (
                      <span className="text-muted-foreground">Waived</span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <PoEmailSentProgress
                          tracked
                          deliveryCount={r.emailDeliveryCount}
                          expectedRecipientCount={r.expectedPoEmailRecipients}
                          emailSentAt={r.emailSentAt}
                          emailReplyReceivedAt={r.emailReplyReceivedAt}
                          emphasizePending={r.emailDeliveryOutstanding}
                          className="mt-0"
                        />
                        {(r.emailSentAt || r.emailDeliveryCount > 0) &&
                        r.emailSentAt ? (
                          <span className="text-[10px] text-muted-foreground">
                            {formatDateTime(r.emailSentAt)}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className={td} onClick={(e) => e.stopPropagation()}>
                    {r.lineItemCount > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto min-h-0 px-1.5 py-0.5 text-xs font-medium tabular-nums text-primary underline-offset-2 hover:underline"
                        onClick={() => openPoLineDialog(r)}
                      >
                        {r.lineItemCount}
                      </Button>
                    ) : (
                      <span className="tabular-nums text-muted-foreground">
                        0
                      </span>
                    )}
                  </td>
                  <td className={`${td} tabular-nums`}>
                    {r.shopifyOrderCount}
                  </td>
                </tr>
              ))}
              {poGap ? (
                <tr>
                  <td
                    colSpan={9}
                    className="py-12 text-center align-middle text-muted-foreground"
                  >
                    <Spinner className="mx-auto size-6" />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>

      {tab === 'shopify' ? (
        <TablePaginationBar
          page={shopifyPage}
          pageCount={shopifyPageCount}
          total={shopifyDisplayTotal}
          loaded={shopifyRows.length}
          loading={shopifyLoading}
          onPageChange={setShopifyPage}
        />
      ) : (
        <TablePaginationBar
          page={poPage}
          pageCount={poPageCount}
          total={poDisplayTotal}
          loaded={poRows.length}
          loading={poLoading}
          onPageChange={setPoPage}
        />
      )}

      <OfficeOrderLineItemsDialog
        open={Boolean(lineDialogOpen && linePreview)}
        onOpenChange={handleLineDialogOpenChange}
        loading={lineLoading}
        error={lineError}
        shopifyAdminStoreHandle={shopifyAdminStoreHandle}
        {...(linePreview?.kind === 'po'
          ? {
              variant: 'po' as const,
              title: linePreview.title,
              subtitle: linePreview.subtitle,
              currency: lineDialogCurrency,
              lines: poDialogLines,
            }
          : {
              variant: 'shopify' as const,
              title: linePreview?.title ?? '',
              subtitle: linePreview?.subtitle ?? '',
              currency: lineDialogCurrency,
              lines: shopifyDialogLines,
            })}
      />
    </div>
  );
}
