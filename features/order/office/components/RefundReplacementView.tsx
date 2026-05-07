'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { ChartBarStacked } from '@/components/chart/BarStackedChart';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EditReasonDialog } from './EditReasonDialog';
import { buildRefundReplacementColumns } from './refund-replacement-columns';
import { Skeleton } from '@/components/ui/skeleton';
import { DEFAULT_REASON_OPTIONS, type ReasonCategory } from './ReasonSelector';

export type RefundReplacementRow = {
  id: string;
  type: 'refund' | 'replacement';
  reasonCategory: string;
  reasonSubcategory: string;
  reasonNotes: string | null;
  purchaseOrderId: string;
  purchaseOrder: { poNumber: string; expectedDate: string | null; supplier: { company: string } };
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: string | null;
  replacementOrderId: string | null;
  newDeliveryDate: string | null;
  customerName: string | null;
  createdBy: { name: string | null; email: string | null } | null;
  createdAt: string;
};

// Category hues: blue, orange, green, purple, teal, pink
const CATEGORY_HUES = [210, 22, 142, 270, 180, 330];

function buildPieColors(options: ReasonCategory[]): Record<string, string> {
  const result: Record<string, string> = {};
  options.forEach((cat, catIdx) => {
    const hue = CATEGORY_HUES[catIdx % CATEGORY_HUES.length];
    result[cat.value] = `hsl(${hue}, 65%, 50%)`;
    cat.subs.forEach((sub, subIdx) => {
      result[sub.value] = `hsl(${hue}, 65%, ${42 + subIdx * 13}%)`;
    });
  });
  return result;
}

function getLabelFromOptions(value: string, options: ReasonCategory[]): string {
  for (const cat of options) {
    if (cat.value === value) return cat.label;
    const sub = cat.subs.find((s) => s.value === value);
    if (sub) return sub.label;
  }
  return value;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function monthAgoIso() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

type PieSlice = { name: string; value: number; fill: string };

const MISS_COLORS = { miss: 'hsl(0, 70%, 55%)', ok: 'hsl(142, 50%, 50%)' };

export function RefundReplacementView() {
  const [records, setRecords] = useState<RefundReplacementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalOrderedQty, setTotalOrderedQty] = useState(0);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(monthAgoIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [typeFilter, setTypeFilter] = useState<'all' | 'refund' | 'replacement'>('all');
  const [editingRecord, setEditingRecord] = useState<RefundReplacementRow | null>(null);
  const [reasonOptions, setReasonOptions] = useState<ReasonCategory[]>(DEFAULT_REASON_OPTIONS);
  const [pieMode, setPieMode] = useState<'category' | 'detail'>('category');

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ startDate, endDate, limit: '200' });
      if (typeFilter !== 'all') params.set('type', typeFilter);
      const res = await fetch(`/api/order/refund-replacements?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as { records: RefundReplacementRow[]; total: number; totalOrderedQty: number };
      setRecords(data.records);
      setTotal(data.total);
      setTotalOrderedQty(data.totalOrderedQty ?? 0);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, typeFilter]);

  useEffect(() => { void fetchRecords(); }, [fetchRecords]);

  useEffect(() => {
    fetch('/api/order/reason-options')
      .then((r) => r.json())
      .then((data: { options?: ReasonCategory[] }) => {
        if (Array.isArray(data.options) && data.options.length > 0) setReasonOptions(data.options);
      })
      .catch(() => {});
  }, []);

  // ── Chart data ─────────────────────────────────────────────────────────────

  const pieData = useMemo((): PieSlice[] => {
    const colors = buildPieColors(reasonOptions);
    const map = new Map<string, PieSlice>();

    for (const r of records) {
      if (pieMode === 'category') {
        const key = r.reasonCategory;
        const label = getLabelFromOptions(key, reasonOptions);
        const fill = colors[key] ?? 'hsl(0,0%,60%)';
        const ex = map.get(key) ?? { name: label, value: 0, fill };
        ex.value += r.quantity;
        map.set(key, ex);
      } else {
        const key = r.reasonSubcategory || r.reasonCategory;
        const label = getLabelFromOptions(key, reasonOptions);
        const fill = colors[key] ?? 'hsl(0,0%,60%)';
        const ex = map.get(key) ?? { name: label, value: 0, fill };
        ex.value += r.quantity;
        map.set(key, ex);
      }
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [records, reasonOptions, pieMode]);

  const amountStats = useMemo(() => {
    let refundQty = 0, refundAmt = 0, replQty = 0, replAmt = 0;
    for (const r of records) {
      const price = r.unitPrice ? parseFloat(r.unitPrice) * r.quantity : 0;
      if (r.type === 'refund') { refundQty += r.quantity; refundAmt += price; }
      else { replQty += r.quantity; replAmt += price; }
    }
    return { refundQty, refundAmt, replQty, replAmt };
  }, [records]);

  const itemDetailData = useMemo(() => {
    type ItemEntry = { item: string; label: string } & Record<string, number>;
    const map = new Map<string, ItemEntry>();
    for (const r of records) {
      const ex = map.get(r.productTitle) ?? { item: r.productTitle, label: r.productTitle };
      const entry = ex as ItemEntry;
      entry[r.reasonCategory] = (entry[r.reasonCategory] ?? 0) + r.quantity;
      map.set(r.productTitle, entry);
    }
    return [...map.values()]
      .sort((a, b) => {
        const sum = (e: ItemEntry) =>
          Object.entries(e).filter(([k]) => k !== 'item' && k !== 'label').reduce((s, [, v]) => s + (v as number), 0);
        return sum(b) - sum(a);
      })
      .slice(0, 15);
  }, [records]);

  const itemDetailConfig = useMemo(() =>
    Object.fromEntries(
      reasonOptions.map((cat, i) => [cat.value, { label: cat.label, color: `var(--chart-${(i % 10) + 1})` }]),
    ),
  [reasonOptions]);

  const bySupplierData = useMemo(() => {
    type Entry = { label: string } & Record<string, number>;
    const map = new Map<string, Entry>();
    for (const r of records) {
      const key = r.purchaseOrder.supplier.company;
      const ex = map.get(key) ?? { label: key };
      (ex as Entry)[r.reasonCategory] = ((ex as Entry)[r.reasonCategory] ?? 0) + r.quantity;
      map.set(key, ex as Entry);
    }
    return [...map.values()]
      .sort((a, b) => {
        const sum = (e: Entry) => Object.entries(e).filter(([k]) => k !== 'label').reduce((s, [, v]) => s + (v as number), 0);
        return sum(b) - sum(a);
      })
      .slice(0, 12);
  }, [records]);

  const byCustomerData = useMemo(() => {
    type Entry = { label: string } & Record<string, number>;
    const map = new Map<string, Entry>();
    for (const r of records) {
      const key = r.customerName ?? 'Unknown';
      const ex = map.get(key) ?? { label: key };
      (ex as Entry)[r.reasonCategory] = ((ex as Entry)[r.reasonCategory] ?? 0) + r.quantity;
      map.set(key, ex as Entry);
    }
    return [...map.values()]
      .sort((a, b) => {
        const sum = (e: Entry) => Object.entries(e).filter(([k]) => k !== 'label').reduce((s, [, v]) => s + (v as number), 0);
        return sum(b) - sum(a);
      })
      .slice(0, 12);
  }, [records]);

  const donutData = useMemo((): PieSlice[] => {
    const missQty = records.reduce((s, r) => s + r.quantity, 0);
    const effectiveTotal = Math.max(totalOrderedQty, missQty);
    const okQty = effectiveTotal - missQty;
    return [
      { name: 'Miss', value: missQty, fill: MISS_COLORS.miss },
      { name: 'No Issue', value: okQty, fill: MISS_COLORS.ok },
    ];
  }, [records, totalOrderedQty]);

  const columns = useMemo(
    () => buildRefundReplacementColumns((row) => setEditingRecord(row), reasonOptions),
    [reasonOptions],
  );

  function handleReasonSaved(updated: { reasonCategory: string; reasonSubcategory: string; reasonNotes: string | null }) {
    if (!editingRecord) return;
    setRecords((prev) => prev.map((r) => (r.id === editingRecord.id ? { ...r, ...updated } : r)));
    setEditingRecord(null);
  }

  const pieTotal = pieData.reduce((s, d) => s + d.value, 0);
  const missQty = records.reduce((s, r) => s + r.quantity, 0);
  const effectiveTotal = Math.max(totalOrderedQty, missQty);
  const missPct = effectiveTotal > 0 ? Math.round((missQty / effectiveTotal) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-auto">
      {/* Filters */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1">
          <Label className="text-[11px]">From (Orig. Delivery)</Label>
          <Input type="date" value={startDate} min="2025-04-20" onChange={(e) => setStartDate(e.target.value < '2025-04-20' ? '2025-04-20' : e.target.value)} className="h-7 text-xs w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">To (Orig. Delivery)</Label>
          <Input type="date" value={endDate} min="2025-04-20" onChange={(e) => setEndDate(e.target.value)} className="h-7 text-xs w-36" />
        </div>
        <div className="flex gap-1">
          {(['all', 'refund', 'replacement'] as const).map((t) => (
            <Button key={t} size="xs" variant={typeFilter === t ? 'default' : 'outline'} className="text-[10px] rounded-[5px] capitalize" onClick={() => setTypeFilter(t)}>
              {t === 'all' ? 'All Types' : t}
            </Button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground ml-auto">{total} record{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Row 1: By Reason · Amount · Item Detail */}
      <div className="flex gap-3 flex-shrink-0 items-stretch">
        {/* By Reason */}
        <div className="border rounded-md bg-background p-3 flex-shrink-0 w-[290px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">By Reason</span>
            <div className="flex rounded-[4px] overflow-hidden border text-[9px]">
              <button
                type="button"
                onClick={() => setPieMode('category')}
                className={`px-1.5 py-0.5 transition-colors ${pieMode === 'category' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Category
              </button>
              <button
                type="button"
                onClick={() => setPieMode('detail')}
                className={`px-1.5 py-0.5 transition-colors border-l ${pieMode === 'detail' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Detail
              </button>
            </div>
          </div>
          {loading ? <PieSkeleton /> : pieTotal === 0 ? <EmptyPanel /> : (
            <div className="flex items-start gap-2">
              <PieChart width={128} height={128}>
                <Pie
                  data={pieData}
                  cx={60}
                  cy={60}
                  outerRadius={58}
                  dataKey="value"
                  labelLine={false}
                  label={({ percent }: { percent?: number }) => (percent ?? 0) > 0.04 ? `${Math.round((percent ?? 0) * 100)}%` : ''}
                >
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const item = payload[0] as { name?: string; value?: number };
                  const pct = pieTotal > 0 ? Math.round(((item.value ?? 0) / pieTotal) * 100) : 0;
                  return (
                    <div className="bg-background border rounded-md shadow-sm px-2 py-1.5 text-xs">
                      <div className="font-medium">{item.name}</div>
                      <div className="text-muted-foreground">{item.value} items · {pct}%</div>
                    </div>
                  );
                }} />
              </PieChart>
              <div className="flex flex-col gap-1 pt-0.5 flex-1 min-w-0">
                {pieData.map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 min-w-0">
                    <span className="h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: d.fill }} />
                    <span className="text-[10px] text-muted-foreground truncate flex-1">{d.name}</span>
                    <span className="text-[10px] font-medium tabular-nums flex-shrink-0">{pieTotal > 0 ? `${Math.round((d.value / pieTotal) * 100)}%` : '0%'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Amount */}
        <div className="border rounded-md bg-background p-3 flex-shrink-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">Amount</div>
          {loading ? (
            <div className="flex flex-col gap-2.5">
              {[1, 2, 3].map((i) => (
                <div key={i}>
                  {i === 3 && <div className="w-full h-px bg-border mb-2.5" />}
                  <Skeleton className="h-3 w-20 mb-1" />
                  <Skeleton className="h-6 w-24 mb-1" />
                  <Skeleton className="h-3 w-14" />
                </div>
              ))}
            </div>
          ) : (
          <div className="flex flex-col gap-2.5">
            {([
              { label: 'Refunds', amt: amountStats.refundAmt, qty: amountStats.refundQty },
              { label: 'Replacements', amt: amountStats.replAmt, qty: amountStats.replQty },
              { label: 'Total', amt: amountStats.refundAmt + amountStats.replAmt, qty: amountStats.refundQty + amountStats.replQty },
            ] as const).map((row, i) => (
              <div key={i}>
                {i === 2 && <div className="w-full h-px bg-border mb-2.5" />}
                <div className="text-[10px] text-muted-foreground">{row.label}</div>
                <div className="text-base font-semibold tabular-nums leading-tight">{fmt(row.amt)}</div>
                <div className="text-[11px] text-muted-foreground">{row.qty} items</div>
              </div>
            ))}
          </div>
          )}
        </div>

        {/* Item Detail */}
        <div className="border rounded-md bg-background p-3 flex-1 min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">Item Detail</div>
          {loading ? <BarChartSkeleton /> : itemDetailData.length === 0 ? <EmptyPanel /> : (
            <ChartBarStacked chartData={itemDetailData} chartConfig={itemDetailConfig} className="h-[160px]" showTooltipLabel xAxisTickMaxLength={12} />
          )}
        </div>
      </div>

      {/* Row 2: By Supplier · By Customer · Miss Rate */}
      <div className="flex gap-3 flex-shrink-0 items-stretch">
        {/* By Supplier */}
        <div className="border rounded-md bg-background p-3 flex-1 min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">By Supplier</div>
          {loading ? <BarChartSkeleton /> : bySupplierData.length === 0 ? <EmptyPanel /> : (
            <ChartBarStacked chartData={bySupplierData} chartConfig={itemDetailConfig} className="h-[160px]" showTooltipLabel xAxisTickMaxLength={10} />
          )}
        </div>

        {/* By Customer */}
        <div className="border rounded-md bg-background p-3 flex-1 min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">By Customer</div>
          {loading ? <BarChartSkeleton /> : byCustomerData.length === 0 ? <EmptyPanel /> : (
            <ChartBarStacked chartData={byCustomerData} chartConfig={itemDetailConfig} className="h-[160px]" showTooltipLabel xAxisTickMaxLength={10} />
          )}
        </div>

        {/* Miss Rate donut */}
        <div className="border rounded-md bg-background p-3 flex-shrink-0 w-[200px]">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">Miss Rate</div>
          {loading ? <DonutSkeleton /> : effectiveTotal === 0 ? <EmptyPanel /> : (
            <div className="flex flex-col items-center gap-2">
              <div className="relative">
                <PieChart width={140} height={140}>
                  <Pie
                    data={donutData}
                    cx={65}
                    cy={65}
                    innerRadius={42}
                    outerRadius={62}
                    dataKey="value"
                    startAngle={90}
                    endAngle={-270}
                    strokeWidth={2}
                    stroke="transparent"
                  >
                    {donutData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const item = payload[0] as { name?: string; value?: number };
                    const pct = effectiveTotal > 0 ? Math.round(((item.value ?? 0) / effectiveTotal) * 100) : 0;
                    return (
                      <div className="bg-background border rounded-md shadow-sm px-2 py-1.5 text-xs">
                        <div className="font-medium">{item.name}</div>
                        <div className="text-muted-foreground">{item.value} items · {pct}%</div>
                      </div>
                    );
                  }} />
                </PieChart>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold tabular-nums leading-none">{missPct}%</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">miss</span>
                </div>
              </div>
              <div className="flex gap-3 text-[10px]">
                {donutData.map((d, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: d.fill }} />
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="font-medium">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0">
        <DataTable columns={columns} data={records} isFetching={loading} disableHiding={true} initialSorting={[{ id: 'deliveryDate', desc: true }]} />
      </div>

      <EditReasonDialog
        open={!!editingRecord}
        onOpenChange={(open) => { if (!open) setEditingRecord(null); }}
        recordId={editingRecord?.id ?? ''}
        initialReason={{
          category: editingRecord?.reasonCategory ?? '',
          subcategory: editingRecord?.reasonSubcategory ?? '',
          notes: editingRecord?.reasonNotes ?? '',
        }}
        onSaved={handleReasonSaved}
        onOptionsSaved={setReasonOptions}
      />
    </div>
  );
}

function EmptyPanel() {
  return (
    <div className="h-[140px] flex items-center justify-center text-[11px] text-muted-foreground">
      No data
    </div>
  );
}

function PieSkeleton() {
  return (
    <div className="flex items-start gap-2">
      <Skeleton className="h-[128px] w-[128px] rounded-full flex-shrink-0" />
      <div className="flex flex-col gap-2 pt-2 flex-1">
        {[80, 65, 55, 70].map((w, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Skeleton className="h-2 w-2 rounded-sm flex-shrink-0" />
            <Skeleton className={`h-2.5`} style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function BarChartSkeleton() {
  const bars = [55, 80, 40, 65, 90, 50, 70, 45];
  return (
    <div className="h-[160px] flex items-end gap-1.5 px-2 pb-6 pt-2">
      {bars.map((h, i) => (
        <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

function DonutSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2">
      <Skeleton className="h-[140px] w-[140px] rounded-full" />
      <div className="flex gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}
