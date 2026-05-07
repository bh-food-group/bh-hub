'use client';
import * as React from 'react';

import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  Updater,
} from '@tanstack/react-table';

import {
  DraggableTableRow,
  DroppableTableBody,
  ScrollableTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { Input } from '@/components/ui/input';
import { useTranslations } from 'next-intl';
import { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import {
  DataTablePagination,
  PaginationType,
} from '@/components/ui/data-table-pagination';
import { DataTableViewOptions } from '@/components/ui/data-table-view-options';
import { Spinner } from '@/components/ui/spinner';
import { DragEndEvent, DndContext, closestCenter } from '@dnd-kit/core';

interface DataTableProps<TData> {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  pagination?: PaginationType;
  setPagination?: Dispatch<SetStateAction<PaginationType>>;
  isFetching: boolean;
  filter?: string;
  onFilterChange?: (filterValue: string) => void;
  onColumnFilterChange?: (columnId: string, value: string | undefined) => void;
  onSortingChange?: (sorting: SortingState) => void;
  sorting?: SortingState;
  addNewRow?: () => void;
  hideNoResults?: boolean;
  showViewOptions?: boolean;
  scrollable?: boolean;
  footerRow?: React.ReactNode;
  tableMeta?: Record<string, any>;
  exclusiveFilterGroups?: string[][];
  disabled?: boolean;
  onDragEnd?: (event: DragEndEvent) => void;
  enableDragAndDrop?: boolean;
  disableSorting?: boolean;
  disableHiding?: boolean;
  filterComponent?: React.ReactNode;
  initialSorting?: SortingState;
}

export function DataTable<TData extends { id: string } = { id: string }>({
  columns,
  data: originalData,
  pagination,
  setPagination,
  isFetching,
  filter,
  onFilterChange,
  onColumnFilterChange,
  onSortingChange,
  sorting: externalSorting,
  addNewRow,
  hideNoResults,
  showViewOptions,
  scrollable,
  footerRow,
  tableMeta,
  exclusiveFilterGroups = [],
  disabled,
  enableDragAndDrop,
  onDragEnd,
  disableSorting = false,
  disableHiding = false,
  filterComponent,
  initialSorting,
}: DataTableProps<TData>) {
  const t = useTranslations();

  const [data, setData] = React.useState<TData[]>(originalData);
  const [internalSorting, setInternalSorting] = React.useState<SortingState>(
    initialSorting ?? [],
  );
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});

  const sorting = externalSorting ?? internalSorting;
  const setSorting = onSortingChange ?? setInternalSorting;

  const handleColumnFiltersChange = React.useCallback(
    (updater: Updater<ColumnFiltersState>) => {
      const newFilters =
        typeof updater === 'function' ? updater(columnFilters) : updater;

      // Handle exclusive filter groups
      const exclusiveResult = handleExclusiveFilterGroups(
        newFilters,
        columnFilters,
        exclusiveFilterGroups,
        onColumnFilterChange,
      );

      if (exclusiveResult.shouldReturn && exclusiveResult.filteredFilters) {
        setColumnFilters(exclusiveResult.filteredFilters);
        return;
      }

      setColumnFilters(newFilters);

      // Notify parent component of column filter changes
      if (onColumnFilterChange) {
        notifyColumnFilterChanges(
          newFilters,
          columnFilters,
          onColumnFilterChange,
        );
      }
    },
    [columnFilters, exclusiveFilterGroups, onColumnFilterChange],
  );

  const handleSortingChange = React.useCallback(
    (updater: Updater<SortingState>) => {
      const newSorting =
        typeof updater === 'function' ? updater(sorting) : updater;
      setSorting(newSorting);
    },
    [sorting, setSorting],
  );

  const processedColumns = React.useMemo(() => {
    let processed = columns;
    if (disableSorting) {
      processed = processed.map((col) => ({
        ...col,
        enableSorting: false,
      }));
    }
    if (disableHiding) {
      processed = processed.map((col) => ({
        ...col,
        enableHiding: false,
      }));
    }
    return processed;
  }, [columns, disableSorting, disableHiding]);

  const table = useReactTable({
    data,
    columns: processedColumns,
    meta: tableMeta,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel:
      pagination && setPagination ? getPaginationRowModel() : undefined,
    onSortingChange: disableSorting ? undefined : handleSortingChange,
    getSortedRowModel:
      disableSorting || onSortingChange ? undefined : getSortedRowModel(),
    onColumnFiltersChange: handleColumnFiltersChange,
    getFilteredRowModel: undefined,
    onColumnVisibilityChange: disableHiding ? undefined : setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting: disableSorting ? [] : sorting,
      columnFilters,
      columnVisibility: disableHiding ? {} : columnVisibility,
      rowSelection,
    },
  });

  React.useEffect(() => {
    setData(originalData);
  }, [originalData]);

  // Handle text search filter changes
  React.useEffect(() => {
    if (!filter || !onFilterChange) return;

    const filterValue = table.getColumn(filter)?.getFilterValue() as
      | string
      | undefined;
    const currentValue = filterValue || '';
    onFilterChange(currentValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFilters, filter, onFilterChange]);

  const TableWrapper = scrollable ? ScrollableTable : Table;

  const handleFilterInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      table.getColumn(filter!)?.setFilterValue(value);
      onFilterChange?.(value);
    },
    [filter, table, onFilterChange],
  );

  const getRowClassName = React.useCallback((row: any) => {
    return row.getVisibleCells().reduce((acc: string, cell: any) => {
      const meta = cell.column.columnDef.meta;
      if (meta?.getRowClassName) {
        const className = meta.getRowClassName(row.original);
        return acc ? `${acc} ${className}` : className;
      }
      return acc;
    }, '');
  }, []);

  const colSpan = columns.length + (enableDragAndDrop ? 1 : 0);

  const renderTableHeader = () => {
    return table.getHeaderGroups().map((headerGroup, i) => (
      <TableRow key={headerGroup.id + i}>
        {enableDragAndDrop && <TableHead className="w-8 p-0" />}
        {headerGroup.headers.map((header, j) => (
          <TableHead
            key={header.id + i + j}
            className={header.column.columnDef.meta?.className}
          >
            {header.isPlaceholder
              ? null
              : flexRender(header.column.columnDef.header, header.getContext())}
          </TableHead>
        ))}
      </TableRow>
    ));
  };

  const renderTableRows = () => {
    if (isFetching) {
      return (
        <TableRow>
          <TableCell colSpan={colSpan} className="h-24">
            <Spinner className="mx-auto my-24 w-8 h-8" />
          </TableCell>
        </TableRow>
      );
    }

    const rows = table.getRowModel().rows;
    const TableRowWrapper = enableDragAndDrop ? DraggableTableRow : TableRow;

    if (rows.length === 0) {
      if (hideNoResults) return null;
      return (
        <TableRow>
          <TableCell colSpan={colSpan} className="h-24">
            No results.
          </TableCell>
        </TableRow>
      );
    }

    return rows.map((row) => {
      const rowClassName = getRowClassName(row);
      const rowId = row.original.id || row.id;
      return (
        <TableRowWrapper
          id={rowId}
          key={rowId}
          className={rowClassName || undefined}
        >
          {row.getVisibleCells().map((cell) => (
            <TableCell
              key={cell.id}
              className={cell.column.columnDef.meta?.className}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          ))}
        </TableRowWrapper>
      );
    });
  };

  const renderAddNewRow = () => {
    if (!addNewRow || disabled) return null;
    return (
      <TableRow>
        <TableCell colSpan={colSpan}>
          <Button
            variant="ghost"
            className="py-0 px-2 w-full h-full justify-start font-medium active:scale-100 text-gray-400 hover:bg-transparent"
            onClick={addNewRow}
            disabled={disabled}
          >
            + {t('UI.addNewRow')}
          </Button>
        </TableCell>
      </TableRow>
    );
  };

  const renderFooterRow = () => {
    if (!footerRow) return null;
    return (
      <TableRow>
        <TableCell colSpan={colSpan}>{footerRow}</TableCell>
      </TableRow>
    );
  };

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      if (!onDragEnd) return;
      onDragEnd(event);
    },
    [onDragEnd],
  );

  const tableContent = (
    <TableWrapper>
      <TableHeader>{renderTableHeader()}</TableHeader>
      {enableDragAndDrop && onDragEnd ? (
        <DroppableTableBody
          items={data as (TData & { id: string })[]}
          setItems={
            setData as Dispatch<SetStateAction<(TData & { id: string })[]>>
          }
          onDragEnd={onDragEnd}
        >
          {renderTableRows()}
          {renderAddNewRow()}
          {renderFooterRow()}
        </DroppableTableBody>
      ) : (
        <TableBody>
          {renderTableRows()}
          {renderAddNewRow()}
          {renderFooterRow()}
        </TableBody>
      )}
    </TableWrapper>
  );

  return (
    <div className={`w-full ${filter ? '' : 'sm:'}space-y-4`}>
      <div className="flex items-center gap-4">
        {filter && (
          <Input
            placeholder={`Filter by ${filter}`}
            value={(table.getColumn(filter)?.getFilterValue() as string) ?? ''}
            onChange={handleFilterInputChange}
            className="max-w-3xl"
          />
        )}
        {filterComponent}
        <DataTableViewOptions
          table={table}
          isHidden={!showViewOptions}
          disableHiding={disableHiding}
        />
      </div>
      <div className="rounded-md border overflow-hidden">
        {enableDragAndDrop ? (
          <DndContext
            onDragEnd={handleDragEnd}
            collisionDetection={closestCenter}
          >
            {tableContent}
          </DndContext>
        ) : (
          tableContent
        )}
      </div>
      {pagination && setPagination && (
        <DataTablePagination
          table={table}
          pagination={pagination}
          setPagination={setPagination}
          isPending={isFetching}
        />
      )}
    </div>
  );
}

/**
 * Handles exclusive filter groups logic - ensures only one filter in a group can be active at a time
 */
function handleExclusiveFilterGroups(
  newFilters: ColumnFiltersState,
  previousFilters: ColumnFiltersState,
  exclusiveFilterGroups: string[][],
  onColumnFilterChange?: (columnId: string, value: string | undefined) => void,
): { shouldReturn: boolean; filteredFilters?: ColumnFiltersState } {
  if (exclusiveFilterGroups.length === 0 || !onColumnFilterChange) {
    return { shouldReturn: false };
  }

  for (const group of exclusiveFilterGroups) {
    const groupFilters = newFilters.filter((f) => group.includes(f.id));
    const prevGroupFilters = previousFilters.filter((f) =>
      group.includes(f.id),
    );

    const filtersWithValues = groupFilters.filter((f) => f.value);
    const prevFiltersWithValues = prevGroupFilters.filter((f) => f.value);

    // Multiple filters in group have values - keep only the most recently changed one
    if (filtersWithValues.length > 1) {
      const changedFilter = filtersWithValues.find(
        (f) => f.value !== prevGroupFilters.find((pf) => pf.id === f.id)?.value,
      );

      if (changedFilter) {
        const filtered = newFilters.filter(
          (f) => !group.includes(f.id) || f.id === changedFilter.id,
        );

        // Notify parent about changes
        onColumnFilterChange(changedFilter.id, changedFilter.value as string);
        group
          .filter((id) => id !== changedFilter.id)
          .forEach((id) => onColumnFilterChange(id, undefined));

        return { shouldReturn: true, filteredFilters: filtered };
      }
    }

    // A filter is being set and another in the group exists - clear the other one
    if (filtersWithValues.length === 1 && prevFiltersWithValues.length > 0) {
      const newFilter = filtersWithValues[0];
      const prevFilter = prevFiltersWithValues[0];

      if (newFilter.id !== prevFilter.id) {
        const filtered = newFilters.filter(
          (f) => !group.includes(f.id) || f.id === newFilter.id,
        );

        onColumnFilterChange(newFilter.id, newFilter.value as string);
        group
          .filter((id) => id !== newFilter.id)
          .forEach((id) => onColumnFilterChange(id, undefined));

        return { shouldReturn: true, filteredFilters: filtered };
      }
    }
  }

  return { shouldReturn: false };
}

/**
 * Notifies parent component about column filter changes
 */
function notifyColumnFilterChanges(
  newFilters: ColumnFiltersState,
  previousFilters: ColumnFiltersState,
  onColumnFilterChange: (columnId: string, value: string | undefined) => void,
) {
  // Notify about new/updated filters
  newFilters.forEach((filter) => {
    onColumnFilterChange(filter.id, filter.value as string | undefined);
  });

  // Notify when filters are cleared
  const clearedFilters = previousFilters.filter(
    (oldFilter) => !newFilters.find((f) => f.id === oldFilter.id),
  );
  clearedFilters.forEach((filter) => {
    onColumnFilterChange(filter.id, undefined);
  });
}
