'use client';

import { createColumnHelper, sortingFns } from '@tanstack/react-table';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pencil } from 'lucide-react';
import { NotePopover } from './NotePopover';
import type { RefundReplacementRow } from './RefundReplacementView';
import type { ReasonCategory } from './ReasonSelector';

// Null sorts to bottom regardless of sort direction
function nullsLastSortingFn<T>(
  rowA: { getValue: (id: string) => unknown },
  rowB: { getValue: (id: string) => unknown },
  columnId: string,
): number {
  const a = rowA.getValue(columnId);
  const b = rowB.getValue(columnId);
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return sortingFns.datetime(rowA as never, rowB as never, columnId);
}

const columnHelper = createColumnHelper<RefundReplacementRow>();

function buildLabelMap(options: ReasonCategory[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const cat of options) {
    map[cat.value] = cat.label;
    for (const sub of cat.subs) {
      map[sub.value] = sub.label;
    }
  }
  return map;
}

export function buildRefundReplacementColumns(
  onEdit: (row: RefundReplacementRow) => void,
  reasonOptions: ReasonCategory[],
) {
  const labelMap = buildLabelMap(reasonOptions);
  return [
    columnHelper.accessor((row) => row.purchaseOrder.expectedDate, {
      id: 'deliveryDate',
      header: 'Orig. Delivery',
      cell: ({ getValue }) => {
        const v = getValue();
        return (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {v ? format(new Date(v), 'yyyy-MM-dd') : '—'}
          </span>
        );
      },
      sortingFn: nullsLastSortingFn,
      meta: { className: 'w-[110px]' },
    }),
    columnHelper.accessor('newDeliveryDate', {
      header: 'New Delivery',
      cell: ({ getValue }) => {
        const v = getValue();
        return (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {v ? format(new Date(v), 'yyyy-MM-dd') : '—'}
          </span>
        );
      },
      sortingFn: nullsLastSortingFn,
      meta: { className: 'w-[110px]' },
    }),
    columnHelper.accessor('type', {
      header: 'Type',
      cell: ({ getValue }) => {
        const t = getValue();
        return (
          <Badge
            variant={t === 'refund' ? 'destructive' : 'amber'}
            className="rounded px-1.5 text-[10px] uppercase"
          >
            {t}
          </Badge>
        );
      },
      meta: { className: 'w-[90px]' },
    }),
    columnHelper.accessor('purchaseOrder.poNumber', {
      id: 'poNumber',
      header: 'PO #',
      cell: ({ getValue }) => (
        <span className="text-[11px] font-mono">{getValue()}</span>
      ),
      meta: { className: 'w-[120px]' },
    }),
    columnHelper.accessor('productTitle', {
      header: 'Item',
      cell: ({ row, getValue }) => (
        <div className="text-[11px]">
          <div className="font-medium leading-tight">{getValue()}</div>
          {row.original.variantTitle && (
            <div className="text-muted-foreground">{row.original.variantTitle}</div>
          )}
        </div>
      ),
    }),
    columnHelper.accessor('quantity', {
      header: 'Qty',
      cell: ({ getValue }) => <span className="text-[11px]">{getValue()}</span>,
      meta: { className: 'w-[50px] text-right' },
    }),
    columnHelper.accessor('unitPrice', {
      header: 'Unit Price',
      cell: ({ getValue }) => {
        const v = getValue();
        return (
          <span className="text-[11px]">
            {v != null ? `$${Number(v).toFixed(2)}` : '—'}
          </span>
        );
      },
      meta: { className: 'w-[80px] text-right' },
    }),
    columnHelper.accessor('reasonCategory', {
      header: 'Reason',
      cell: ({ getValue }) => (
        <span className="text-[11px]">{labelMap[getValue()] ?? getValue()}</span>
      ),
      meta: { className: 'w-[130px]' },
    }),
    columnHelper.accessor('reasonSubcategory', {
      header: 'Detail',
      cell: ({ getValue }) => (
        <span className="text-[11px]">{labelMap[getValue()] ?? getValue()}</span>
      ),
      meta: { className: 'w-[130px]' },
    }),
    columnHelper.accessor('reasonNotes', {
      header: 'Notes',
      cell: ({ getValue }) => {
        const v = getValue();
        return v ? <NotePopover note={v} label="Detail note" /> : <span className="text-[11px] text-muted-foreground">—</span>;
      },
      meta: { className: 'w-[52px] text-center' },
    }),
    columnHelper.accessor('createdBy', {
      id: 'createdBy',
      header: 'By',
      cell: ({ getValue }) => {
        const u = getValue();
        if (!u) return <span className="text-[11px] text-muted-foreground">—</span>;
        return (
          <span className="text-[11px]">{u.name ?? u.email ?? '—'}</span>
        );
      },
      meta: { className: 'w-[100px]' },
    }),
    columnHelper.display({
      id: 'actions',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="xs"
          className="h-6 w-6 p-0"
          onClick={() => onEdit(row.original)}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      ),
      enableSorting: false,
      meta: { className: 'w-[36px]' },
    }),
  ];
}
