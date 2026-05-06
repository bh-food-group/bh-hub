'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pencil } from 'lucide-react';
import type { RefundReplacementRow } from './RefundReplacementView';

const columnHelper = createColumnHelper<RefundReplacementRow>();

const REASON_LABELS: Record<string, string> = {
  supply_shortage: 'Supply Shortage',
  item_damage: 'Item Damage',
  human_error: 'Human Error',
  out_of_stock: 'Out of Stock',
  payment_not_cleared: 'Payment Not Cleared',
  unknown_damage: 'Unknown Damage',
  poor_packaging: 'Poor Packaging',
  office: 'Office',
  supply: 'Supply',
  delivery: 'Delivery',
};

export function buildRefundReplacementColumns(
  onEdit: (row: RefundReplacementRow) => void,
) {
  return [
    columnHelper.accessor('createdAt', {
      header: 'Date',
      cell: ({ getValue }) => (
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {format(new Date(getValue()), 'yyyy-MM-dd')}
        </span>
      ),
      meta: { className: 'w-[100px]' },
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
        <span className="text-[11px]">{REASON_LABELS[getValue()] ?? getValue()}</span>
      ),
      meta: { className: 'w-[130px]' },
    }),
    columnHelper.accessor('reasonSubcategory', {
      header: 'Detail',
      cell: ({ getValue }) => (
        <span className="text-[11px]">{REASON_LABELS[getValue()] ?? getValue()}</span>
      ),
      meta: { className: 'w-[130px]' },
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
