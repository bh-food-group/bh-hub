'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChartBarStacked } from '@/components/chart/BarStackedChart';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { EditReasonDialog } from './EditReasonDialog';
import { buildRefundReplacementColumns } from './refund-replacement-columns';

export type RefundReplacementRow = {
  id: string;
  type: 'refund' | 'replacement';
  reasonCategory: string;
  reasonSubcategory: string;
  reasonNotes: string | null;
  purchaseOrderId: string;
  purchaseOrder: { poNumber: string };
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: string | null;
  replacementOrderId: string | null;
  createdBy: { name: string | null; email: string | null } | null;
  createdAt: string;
};

const REASON_LABELS: Record<string, string> = {
  supply_shortage: 'Supply Shortage',
  item_damage: 'Item Damage',
  human_error: 'Human Error',
};

const SUB_LABELS: Record<string, string> = {
  out_of_stock: 'Out of Stock',
  payment_not_cleared: 'Payment Not Cleared',
  unknown_damage: 'Unknown Damage',
  poor_packaging: 'Poor Packaging',
  office: 'Office',
  supply: 'Supply',
  delivery: 'Delivery',
};

type ChartTab = 'byItem' | 'byReason' | 'amount' | 'itemDetail';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function monthAgoIso() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export function RefundReplacementView() {
  const [records, setRecords] = useState<RefundReplacementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(monthAgoIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [typeFilter, setTypeFilter] = useState<'all' | 'refund' | 'replacement'>('all');
  const [activeTab, setActiveTab] = useState<ChartTab>('byItem');
  const [editingRecord, setEditingRecord] = useState<RefundReplacementRow | null>(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ startDate, endDate, limit: '200' });
      if (typeFilter !== 'all') params.set('type', typeFilter);
      const res = await fetch(`/api/order/refund-replacements?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as { records: RefundReplacementRow[]; total: number };
      setRecords(data.records);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, typeFilter]);

  useEffect(() => { void fetchRecords(); }, [fetchRecords]);

  // ── Chart data ─────────────────────────────────────────────────────────────

  const byItemData = useMemo(() => {
    const map = new Map<string, { item: string; refund: number; replacement: number }>();
    for (const r of records) {
      const entry = map.get(r.productTitle) ?? { item: r.productTitle, refund: 0, replacement: 0 };
      if (r.type === 'refund') entry.refund += r.quantity;
      else entry.replacement += r.quantity;
      map.set(r.productTitle, entry);
    }
    return [...map.values()]
      .sort((a, b) => b.refund + b.replacement - (a.refund + a.replacement))
      .slice(0, 15)
      .map((d) => ({ ...d, item: d.item.length > 22 ? d.item.slice(0, 22) + '…' : d.item }));
  }, [records]);

  const byReasonData = useMemo(() => {
    type ReasonEntry = { reason: string } & Record<string, number>;
    const map = new Map<string, ReasonEntry>();
    for (const r of records) {
      const existing = map.get(r.reasonCategory) ?? { reason: REASON_LABELS[r.reasonCategory] ?? r.reasonCategory };
      const entry = existing as ReasonEntry;
      entry[r.reasonSubcategory] = (entry[r.reasonSubcategory] ?? 0) + r.quantity;
      map.set(r.reasonCategory, entry);
    }
    return [...map.values()];
  }, [records]);

  const amountData = useMemo(() => {
    const map = new Map<string, { date: string; refundAmount: number; replacementAmount: number }>();
    for (const r of records) {
      const month = r.createdAt.slice(0, 7);
      const entry = map.get(month) ?? { date: month, refundAmount: 0, replacementAmount: 0 };
      const price = r.unitPrice ? parseFloat(r.unitPrice) * r.quantity : 0;
      if (r.type === 'refund') entry.refundAmount += price;
      else entry.replacementAmount += price;
      map.set(month, entry);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [records]);

  const itemDetailData = useMemo(() => {
    type ItemEntry = { item: string } & Record<string, number>;
    const map = new Map<string, ItemEntry>();
    for (const r of records) {
      const existing = map.get(r.productTitle) ?? { item: r.productTitle };
      const entry = existing as ItemEntry;
      entry[r.reasonCategory] = (entry[r.reasonCategory] ?? 0) + r.quantity;
      map.set(r.productTitle, entry);
    }
    return [...map.values()]
      .sort((a, b) => {
        const sumOf = (e: ItemEntry) =>
          Object.entries(e).filter(([k]) => k !== 'item').reduce((s, [, v]) => s + (v as number), 0);
        return sumOf(b) - sumOf(a);
      })
      .slice(0, 15)
      .map((d) => ({ ...d, item: d.item.length > 22 ? d.item.slice(0, 22) + '…' : d.item }));
  }, [records]);

  const allSubkeys = useMemo(() => [...new Set(records.map((r) => r.reasonSubcategory))], [records]);
  const categoryKeys = ['supply_shortage', 'item_damage', 'human_error'];

  const itemChartConfig = {
    refund: { label: 'Refund', color: 'var(--chart-2)' },
    replacement: { label: 'Replacement', color: 'var(--chart-4)' },
  };
  const amountChartConfig = {
    refundAmount: { label: 'Refund ($)', color: 'var(--chart-2)' },
    replacementAmount: { label: 'Replacement ($)', color: 'var(--chart-4)' },
  };
  const reasonChartConfig = Object.fromEntries(
    allSubkeys.map((k, i) => [k, { label: SUB_LABELS[k] ?? k, color: `var(--chart-${(i % 10) + 1})` }]),
  );
  const itemDetailConfig = Object.fromEntries(
    categoryKeys.map((k, i) => [k, { label: REASON_LABELS[k] ?? k, color: `var(--chart-${(i % 10) + 1})` }]),
  );

  const columns = useMemo(() => buildRefundReplacementColumns((row) => setEditingRecord(row)), []);

  function handleReasonSaved(updated: { reasonCategory: string; reasonSubcategory: string; reasonNotes: string | null }) {
    if (!editingRecord) return;
    setRecords((prev) => prev.map((r) => (r.id === editingRecord.id ? { ...r, ...updated } : r)));
    setEditingRecord(null);
  }

  const tabs: { id: ChartTab; label: string }[] = [
    { id: 'byItem', label: 'By Item' },
    { id: 'byReason', label: 'By Reason' },
    { id: 'amount', label: 'Amount' },
    { id: 'itemDetail', label: 'Item Detail' },
  ];

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-auto">
      {/* Filters */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1">
          <Label className="text-[11px]">From</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-7 text-xs w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">To</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-7 text-xs w-36" />
        </div>
        <div className="flex gap-1">
          {(['all', 'refund', 'replacement'] as const).map((t) => (
            <Button
              key={t}
              size="xs"
              variant={typeFilter === t ? 'default' : 'outline'}
              className="text-[10px] rounded-[5px] capitalize"
              onClick={() => setTypeFilter(t)}
            >
              {t === 'all' ? 'All Types' : t}
            </Button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground ml-auto">{total} record{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Chart tabs */}
      <div className="flex-shrink-0 space-y-2">
        <div className="flex gap-1 border-b pb-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-3 py-1 text-[11px] rounded-t transition-colors',
                activeTab === tab.id
                  ? 'bg-background border border-b-background text-foreground font-medium -mb-px'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="h-48">
          {activeTab === 'byItem' && (
            byItemData.length > 0
              ? <ChartBarStacked chartData={byItemData} chartConfig={itemChartConfig} className="h-48" />
              : <EmptyChart />
          )}
          {activeTab === 'byReason' && (
            byReasonData.length > 0
              ? <ChartBarStacked chartData={byReasonData} chartConfig={reasonChartConfig} className="h-48" />
              : <EmptyChart />
          )}
          {activeTab === 'amount' && (
            amountData.length > 0
              ? <ChartBarStacked chartData={amountData} chartConfig={amountChartConfig} className="h-48" />
              : <EmptyChart />
          )}
          {activeTab === 'itemDetail' && (
            itemDetailData.length > 0
              ? <ChartBarStacked chartData={itemDetailData} chartConfig={itemDetailConfig} className="h-48" />
              : <EmptyChart />
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0">
        <DataTable columns={columns} data={records} isFetching={loading} disableHiding={true} />
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
      />
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-48 flex items-center justify-center text-[11px] text-muted-foreground border rounded-md bg-muted/20">
      No data for selected range
    </div>
  );
}
