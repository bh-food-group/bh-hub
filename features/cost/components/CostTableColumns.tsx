'use client';

import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import { createColumnHelper } from '@tanstack/react-table';
import { format } from 'date-fns';
import TagBadge from './TagBadge';
import RecipePrintButton from './RecipePrintButton';
import { renderDefinedPrices, renderFinalPrice } from '../utils/priceHelpers';
import type { CostListItem } from '../types/cost';

const columnHelper = createColumnHelper<CostListItem>();

export const costColumns = [
  columnHelper.accessor('title', {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Cost.title" />
    ),
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue()}</span>
    ),
  }),
  columnHelper.accessor('tags', {
    id: 'tags',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Cost.tags" />
    ),
    cell: ({ getValue }) => {
      const tags = getValue();
      if (!tags.length) return <span className="text-muted-foreground">-</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <TagBadge key={tag.id} tag={tag} />
          ))}
        </div>
      );
    },
    enableSorting: false,
  }),
  columnHelper.display({
    id: 'finalPrice',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Cost.finalPrice" />
    ),
    cell: ({ row }) => renderFinalPrice(row.original),
    enableSorting: false,
  }),
  columnHelper.display({
    id: 'prices',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Cost.price" />
    ),
    cell: ({ row }) => renderDefinedPrices(row.original),
    enableSorting: false,
  }),
  columnHelper.accessor('createdAt', {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Cost.createdAt" />
    ),
    cell: ({ getValue }) => {
      const date = getValue();
      if (!date) return <span className="text-muted-foreground">-</span>;
      return (
        <span className="text-sm tabular-nums">
          {format(new Date(date), 'yyyy-MM-dd HH:mm')}
        </span>
      );
    },
    meta: { className: 'min-w-[140px]' },
  }),
  columnHelper.accessor('updatedAt', {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Cost.updatedAt" />
    ),
    cell: ({ getValue }) => {
      const date = getValue();
      if (!date) return <span className="text-muted-foreground">-</span>;
      return (
        <span className="text-sm tabular-nums">
          {format(new Date(date), 'yyyy-MM-dd HH:mm')}
        </span>
      );
    },
    meta: { className: 'min-w-[140px]' },
  }),
  columnHelper.display({
    id: 'actions',
    cell: ({ row }) => <RecipePrintButton costId={row.original.id} />,
    enableSorting: false,
    enableHiding: false,
    meta: { className: 'w-[40px]' },
  }),
];
