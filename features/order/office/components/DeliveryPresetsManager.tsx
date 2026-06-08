'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  cloneBhSplitTemplateWindows,
  parseIsoWeekWindows,
  type IsoWeekWindow,
} from '@/lib/order/supplier-delivery-schedule';
import { PartitionWindowsEditor } from './PartitionWindowsEditor';
import { validatePartitionWindows } from '../hooks/use-supplier-delivery-schedule-form';
import type { CustomerOption } from './SupplierCustomerScheduleOverrides';

export type DeliveryPresetData = {
  id: string;
  name: string;
  /** Raw JSON windows from the DB. */
  windows: unknown;
  customerExceptions: { customerId: string; windows: unknown }[];
};

/** A group of customers that share one set of exception windows. `id` is a client-only key. */
type ExceptionGroup = { id: string; customerIds: string[]; windows: IsoWeekWindow[] };

function windowsFromRaw(raw: unknown): IsoWeekWindow[] {
  return parseIsoWeekWindows(raw) ?? cloneBhSplitTemplateWindows();
}

/** Group stored per-customer exceptions by identical windows so they edit together. */
function groupExceptions(
  rows: { customerId: string; windows: unknown }[],
): ExceptionGroup[] {
  const bySig = new Map<string, ExceptionGroup>();
  for (const r of rows) {
    const w = windowsFromRaw(r.windows);
    const sig = JSON.stringify(w);
    const g = bySig.get(sig);
    if (g) g.customerIds.push(r.customerId);
    else bySig.set(sig, { id: `e${bySig.size}`, customerIds: [r.customerId], windows: w });
  }
  return [...bySig.values()];
}

type EditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null = create a new preset. */
  preset: DeliveryPresetData | null;
  customers: CustomerOption[];
  onSaved: () => void;
};

function DeliveryPresetEditorDialog({
  open,
  onOpenChange,
  preset,
  customers,
  onSaved,
}: EditorProps) {
  const isEdit = preset !== null;
  const [name, setName] = useState(preset?.name ?? '');
  const [windows, setWindows] = useState<IsoWeekWindow[]>(() =>
    windowsFromRaw(preset?.windows),
  );
  const idCounter = useRef(0);
  const [exceptions, setExceptions] = useState<ExceptionGroup[]>(() =>
    groupExceptions(preset?.customerExceptions ?? []),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(c.id, c.name);
    return m;
  }, [customers]);

  const usedIds = useMemo(
    () => new Set(exceptions.flatMap((e) => e.customerIds)),
    [exceptions],
  );
  const availableCustomers = useMemo(
    () => customers.filter((c) => !usedIds.has(c.id)),
    [customers, usedIds],
  );

  function addGroup() {
    setExceptions((prev) => [
      ...prev,
      { id: `new${idCounter.current++}`, customerIds: [], windows: [...windows] },
    ]);
  }

  function addCustomer(groupId: string, customerId: string) {
    if (!customerId) return;
    setExceptions((prev) =>
      prev.map((g) =>
        g.id === groupId && !g.customerIds.includes(customerId)
          ? { ...g, customerIds: [...g.customerIds, customerId] }
          : g,
      ),
    );
  }

  function removeCustomer(groupId: string, customerId: string) {
    setExceptions((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, customerIds: g.customerIds.filter((c) => c !== customerId) }
          : g,
      ),
    );
  }

  function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError('Preset name is required.');
      return;
    }
    const defErr = validatePartitionWindows(windows);
    if (defErr) {
      setError(defErr);
      return;
    }
    const customerExceptions: { customerId: string; windows: IsoWeekWindow[] }[] = [];
    for (const ex of exceptions) {
      if (ex.customerIds.length === 0) continue;
      const exErr = validatePartitionWindows(ex.windows);
      if (exErr) {
        setError(`Exception group: ${exErr}`);
        return;
      }
      for (const cid of ex.customerIds) {
        customerExceptions.push({ customerId: cid, windows: ex.windows });
      }
    }

    startTransition(async () => {
      const url = isEdit
        ? `/api/order/delivery-presets/${preset.id}`
        : '/api/order/delivery-presets';
      const method = isEdit ? 'PUT' : 'POST';
      const body = isEdit
        ? { name: name.trim(), windows, customerExceptions }
        : { name: name.trim(), windows };
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? `Failed (${res.status})`);
        return;
      }
      onSaved();
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <div className="shrink-0 space-y-1.5 border-b px-6 pt-6 pb-4 pr-14">
          <DialogHeader className="space-y-1.5 text-left">
            <DialogTitle>{isEdit ? 'Edit preset' : 'New delivery preset'}</DialogTitle>
            <DialogDescription>
              Define the default weekly partition windows, plus per-customer
              exceptions. Suppliers using this preset update automatically.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4 space-y-3">
          {error && (
            <p className="text-[11px] text-destructive rounded bg-destructive/10 px-2 py-1">
              {error}
            </p>
          )}
          <div className="grid gap-2">
            <Label htmlFor="preset-name" className="text-xs">
              Name *
            </Label>
            <Input
              id="preset-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BH Shipping"
              maxLength={60}
              className="h-auto min-h-0 text-sm px-2 py-1.5 md:text-sm"
            />
          </div>

          <div className="grid gap-1.5 rounded-md border border-border/60 p-2.5">
            <Label className="text-xs">Default windows</Label>
            <PartitionWindowsEditor windows={windows} onChange={setWindows} />
          </div>

          {isEdit && (
            <div className="grid gap-2 rounded-md border border-border/60 p-2.5">
              <Label className="text-xs">Customer exceptions</Label>
              <p className="text-[10px] text-muted-foreground -mt-0.5">
                Override the default windows for specific customers using this preset.
              </p>
              {exceptions.length > 0 && (
                <div className="flex flex-col gap-2">
                  {exceptions.map((ex, i) => (
                    <div
                      key={ex.id}
                      className="rounded-md border border-border/70 bg-muted/10 p-2 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                          Customers
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 shrink-0 px-1.5 text-[10px] text-destructive"
                          onClick={() =>
                            setExceptions((prev) => prev.filter((e) => e.id !== ex.id))
                          }
                        >
                          Remove group
                        </Button>
                      </div>
                      {ex.customerIds.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {ex.customerIds.map((cid) => (
                            <span
                              key={cid}
                              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
                            >
                              {nameById.get(cid) ?? cid}
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground text-[10px] leading-none cursor-pointer"
                                onClick={() => removeCustomer(ex.id, cid)}
                              >
                                &times;
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <Select
                        value=""
                        onValueChange={(v) => addCustomer(ex.id, v)}
                        disabled={availableCustomers.length === 0}
                      >
                        <SelectTrigger className="h-7 px-2 text-[10px]">
                          <SelectValue
                            placeholder={
                              availableCustomers.length === 0
                                ? 'No more customers'
                                : 'Add customer…'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {availableCustomers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <PartitionWindowsEditor
                        windows={ex.windows}
                        onChange={(w) =>
                          setExceptions((prev) =>
                            prev.map((e, j) => (j === i ? { ...e, windows: w } : e)),
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 w-fit text-[10px]"
                onClick={addGroup}
              >
                Add exception group
              </Button>
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t px-6 py-4 gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Saving…' : isEdit ? 'Save preset' : 'Create preset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Props = {
  presets: DeliveryPresetData[];
  customers: CustomerOption[];
};

export function DeliveryPresetsManager({ presets, customers }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<DeliveryPresetData | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setError(null);
    const res = await fetch(`/api/order/delivery-presets/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? `Failed (${res.status})`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2 pt-2 border-t">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Delivery presets</h2>
        <Button
          variant="ghost"
          size="xs"
          className="text-[10px]"
          onClick={() => {
            setError(null);
            setCreating(true);
          }}
        >
          + Add
        </Button>
      </div>

      {error && (
        <p className="text-[11px] text-destructive rounded bg-destructive/10 px-2 py-1">
          {error}
        </p>
      )}

      <div className="rounded-md border divide-y">
        {presets.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No presets yet. Add one (e.g. “BH Shipping”) to reuse across suppliers.
          </p>
        ) : (
          presets.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-3 py-2">
              <span className="text-sm">
                {p.name}
                {p.customerExceptions.length > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-1.5">
                    {p.customerExceptions.length} exception
                    {p.customerExceptions.length !== 1 ? 's' : ''}
                  </span>
                )}
              </span>
              <div className="flex gap-0.5">
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-[10px] h-5 px-1"
                  onClick={() => {
                    setError(null);
                    setEditing(p);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-[10px] h-5 px-1 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(p.id)}
                >
                  Del
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {creating && (
        <DeliveryPresetEditorDialog
          open={creating}
          onOpenChange={(o) => !o && setCreating(false)}
          preset={null}
          customers={customers}
          onSaved={() => router.refresh()}
        />
      )}
      {editing && (
        <DeliveryPresetEditorDialog
          key={editing.id}
          open={editing !== null}
          onOpenChange={(o) => !o && setEditing(null)}
          preset={editing}
          customers={customers}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
