'use client';

import { DataTable } from '@/components/ui/data-table';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import { Check, Eye, EyeOff, Pencil, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ManageRealmsDialog } from '@/features/locations/components/ManageRealmsDialog';
import type { RealmWithConnection } from '@/features/locations/components/ManageRealmsDialog';
import { AddLocationDialog } from '@/features/locations/components/AddLocationDialog';
import { ClassName } from '@/types/className';
import { cn } from '@/lib/utils';
import { YearMonthPicker } from '@/components/ui/year-month-picker';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { parseYearMonth } from '@/lib/utils';
import { MONTH_NAMES } from '@/constants/date';
import { getCurrentYearMonth } from '@/lib/utils';

export type RealmOption = { id: string; name: string };

export type LocationRow = {
  id: string;
  code: string;
  name: string;
  classId: string | null;
  realmId: string;
  realmName: string | null;
  startYearMonth: string | null;
  showBudget: boolean;
  cloverMerchantId: string | null;
  cloverToken: string | null;
  orderEmail: string | null;
};

type LocationsContentProps = {
  realms: RealmWithConnection[];
  isAdmin: boolean;
  locations: LocationRow[];
};

async function patchLocation(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/location/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j?.error ?? res.statusText);
  }
}

export function LocationsContent({
  realms: initialRealms,
  isAdmin,
  locations: initialLocations,
}: LocationsContentProps) {
  const router = useRouter();
  const [locations, setLocations] = useState<LocationRow[]>(initialLocations);
  const [realmsWithConnection, setRealmsWithConnection] =
    useState<RealmWithConnection[]>(initialRealms);
  const realms: RealmOption[] = realmsWithConnection.map((r) => ({
    id: r.id,
    name: r.name,
  }));

  useEffect(() => {
    setLocations(initialLocations);
  }, [initialLocations]);

  useEffect(() => {
    setRealmsWithConnection(initialRealms);
  }, [initialRealms]);

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const updateLocation = useCallback(
    async (row: LocationRow, field: string, value: unknown) => {
      const previous = locations.find((l) => l.id === row.id);
      if (!previous) return;

      const optimisticLocation: LocationRow = {
        ...previous,
        [field]: value as string | null,
        ...(field === 'realmId' && typeof value === 'string'
          ? { realmName: realms.find((r) => r.id === value)?.name ?? null }
          : {}),
        ...(field === 'startYearMonth'
          ? { startYearMonth: value as string | null }
          : {}),
        ...(field === 'showBudget' ? { showBudget: value as boolean } : {}),
      };

      setLocations((prev) =>
        prev.map((l) => (l.id === row.id ? optimisticLocation : l)),
      );

      try {
        await patchLocation(row.id, { [field]: value });
        toast.success('Updated');
      } catch (e) {
        setLocations((prev) =>
          prev.map((l) => (l.id === row.id ? previous : l)),
        );
        toast.error(e instanceof Error ? e.message : 'Update failed');
      }
    },
    [locations, realms],
  );

  const columns: ColumnDef<LocationRow>[] = [
    {
      accessorKey: 'code',
      header: 'Code',
      cell: ({ row }: { row: Row<LocationRow> }) => (
        <EditableCell
          row={row}
          field="code"
          onSave={(v) => updateLocation(row.original, 'code', v)}
        />
      ),
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }: { row: Row<LocationRow> }) => (
        <EditableCell
          row={row}
          field="name"
          className="max-w-full"
          onSave={(v) => updateLocation(row.original, 'name', v)}
        />
      ),
    },
    {
      accessorKey: 'realmId',
      header: 'Realm',
      cell: ({ row }: { row: Row<LocationRow> }) => (
        <RealmSelectCell
          row={row}
          realms={realms}
          onSave={(realmId) => updateLocation(row.original, 'realmId', realmId)}
        />
      ),
    },
    {
      accessorKey: 'classId',
      header: 'Class ID',
      cell: ({ row }: { row: Row<LocationRow> }) => (
        <EditableCell
          row={row}
          field="classId"
          onSave={(v) =>
            updateLocation(row.original, 'classId', v === '' ? null : v)
          }
        />
      ),
    },
    {
      accessorKey: 'orderEmail',
      header: 'Order Email',
      cell: ({ row }: { row: Row<LocationRow> }) => (
        <EditableCell
          row={row}
          field="orderEmail"
          onSave={(v) =>
            updateLocation(row.original, 'orderEmail', v === '' ? null : v)
          }
        />
      ),
    },
    {
      accessorKey: 'startYearMonth',
      header: 'Start',
      cell: ({ row }: { row: Row<LocationRow> }) => (
        <StartYearMonthCell
          row={row}
          onSave={(v) => updateLocation(row.original, 'startYearMonth', v)}
        />
      ),
    },
    {
      accessorKey: 'showBudget',
      header: 'Show in Budget',
      cell: ({ row }: { row: Row<LocationRow> }) => (
        <Switch
          checked={row.original.showBudget}
          onCheckedChange={(checked) =>
            updateLocation(row.original, 'showBudget', checked)
          }
          aria-label="Show in budget"
        />
      ),
    },
    {
      accessorKey: 'cloverMerchantId',
      header: 'Clover Merchant ID',
      cell: ({ row }: { row: Row<LocationRow> }) => (
        <EditableCell
          row={row}
          field="cloverMerchantId"
          onSave={(v) =>
            updateLocation(row.original, 'cloverMerchantId', v === '' ? null : v)
          }
        />
      ),
    },
    {
      accessorKey: 'cloverToken',
      header: 'Clover Token',
      cell: ({ row }: { row: Row<LocationRow> }) => (
        <CloverTokenCell
          value={row.original.cloverToken}
          onSave={(v) =>
            updateLocation(row.original, 'cloverToken', v === '' ? null : v)
          }
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Locations</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ManageRealmsDialog
            realms={realmsWithConnection}
            isAdmin={isAdmin}
            onOpenChange={(open) => {
              if (!open) refresh();
            }}
            onRealmsRefetch={refresh}
          />
          <AddLocationDialog realms={realms} onSuccess={refresh} />
        </div>
      </div>
      <DataTable<LocationRow>
        columns={columns}
        data={locations}
        isFetching={false}
      />
    </div>
  );
}

function RealmSelectCell({
  row,
  realms,
  onSave,
}: {
  row: Row<LocationRow>;
  realms: RealmOption[];
  onSave: (realmId: string) => void;
}) {
  const realmId = row.original.realmId;
  const realmName = row.original.realmName;

  if (realms.length === 0) {
    return (
      <span className="text-muted-foreground text-sm">
        {realmName ?? (realmId ? `Realm` : '—')}
      </span>
    );
  }

  return (
    <Select
      value={realmId}
      onValueChange={(v) => {
        if (v && v !== realmId) onSave(v);
      }}
    >
      <SelectTrigger
        size="sm"
        className="max-w-[200px] min-w-0"
        aria-label="Select realm"
      >
        <SelectValue placeholder="Select realm" />
      </SelectTrigger>
      <SelectContent>
        {realms.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function formatStartYearMonth(ym: string): string {
  const { year, month } = parseYearMonth(ym);
  return `${MONTH_NAMES[month]} ${year}`;
}

function StartYearMonthCell({
  row,
  onSave,
}: {
  row: Row<LocationRow>;
  onSave: (value: string | null) => void;
}) {
  const value = row.original.startYearMonth;
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="flex max-w-[140px] items-center gap-1">
          <span className="min-w-0 truncate text-sm">
            {value ? formatStartYearMonth(value) : '—'}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Edit start month"
            className="opacity-50"
            onClick={() => setOpen(true)}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="flex flex-col gap-2">
          <YearMonthPicker
            value={value ?? getCurrentYearMonth()}
            onChange={(ym) => {
              onSave(ym);
              setOpen(false);
            }}
            triggerClassName="border border-input bg-background"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onSave(null);
              setOpen(false);
            }}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CloverTokenCell({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (value: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [draft, setDraft] = useState('');

  const handleEdit = () => {
    setDraft('');
    setIsEditing(true);
  };

  const handleSave = () => {
    onSave(draft.trim());
    setIsEditing(false);
    setDraft('');
  };

  const handleCancel = () => {
    setIsEditing(false);
    setDraft('');
  };

  if (isEditing) {
    return (
      <div className="flex max-w-[260px] items-center gap-1">
        <Input
          className="h-8 flex-1 min-w-0 font-mono text-xs"
          type="text"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') handleCancel();
          }}
          placeholder="Paste token…"
        />
        <div className="flex">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Save" onClick={handleSave}>
            <Check className="size-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel" onClick={handleCancel}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  const isSet = Boolean(value);
  const display = isSet
    ? revealed
      ? value!
      : '••••••••••••••••'
    : '—';

  return (
    <div className="flex max-w-[260px] items-center gap-1">
      <span className={cn('min-w-0 truncate font-mono text-xs', !isSet && 'text-muted-foreground')}>
        {display}
      </span>
      {isSet && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={revealed ? 'Hide token' : 'Reveal token'}
          className="opacity-50"
          onClick={() => setRevealed((v) => !v)}
        >
          {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Edit token"
        className="opacity-50"
        onClick={handleEdit}
      >
        <Pencil className="size-3.5" />
      </Button>
    </div>
  );
}

function EditableCell({
  row,
  field,
  onSave,
  className,
}: {
  row: Row<LocationRow>;
  field: 'code' | 'name' | 'classId' | 'cloverMerchantId' | 'orderEmail';
  onSave: (value: string) => void;
} & ClassName) {
  const current = row.original[field] ?? '';
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(current);
  useEffect(() => {
    setValue(row.original[field] ?? '');
  }, [row.original[field], field]);

  // Fields that may be cleared back to empty (saved as null by the caller).
  const clearable = field === 'classId' || field === 'orderEmail';

  const handleSave = () => {
    const v = value.trim();
    if (clearable) {
      if (v !== current) onSave(v);
    } else {
      if (v.length > 0 && v !== current) onSave(v);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setValue(current);
    setIsEditing(false);
  };

  const displayValue = current || '—';

  if (!isEditing) {
    return (
      <div className={cn('flex max-w-[220px] items-center gap-1', className)}>
        <span className="min-w-0 truncate">{displayValue}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${field}`}
          className="opacity-50"
          onClick={() => setIsEditing(true)}
        >
          <Pencil className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex max-w-[240px] items-center gap-1">
      <Input
        className="h-8 flex-1 min-w-0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') handleCancel();
        }}
        placeholder={field === 'classId' ? 'Optional' : undefined}
      />
      <div className="flex">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Save"
          onClick={handleSave}
        >
          <Check className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Cancel"
          onClick={handleCancel}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
