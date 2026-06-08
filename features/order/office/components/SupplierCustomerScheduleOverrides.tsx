'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SupplierDeliverySchedule } from '@/lib/order/supplier-delivery-schedule';
import { parseSupplierDeliverySchedule } from '@/lib/order/supplier-delivery-schedule';
import {
  SupplierDeliveryScheduleFields,
  type DeliveryPresetOption,
} from './SupplierDeliveryScheduleFields';
import { useSupplierDeliveryScheduleForm } from '../hooks/use-supplier-delivery-schedule-form';

export type CustomerOption = { id: string; name: string };

export type CustomerScheduleOverrideInput = {
  customerId: string;
  /** Raw stored schedule JSON (validated/parsed by the form hook). */
  schedule: unknown;
};

export type CustomerScheduleOverridesHandle = {
  /**
   * Read the current overrides for submit, expanded to one row per customer.
   * `error` is non-null when any group is invalid. Groups that resolve to no
   * schedule ("Off") or have no customers are dropped.
   */
  collect: () => {
    rows: { customerId: string; schedule: SupplierDeliverySchedule }[];
    error: string | null;
  };
};

type RowReport = { schedule: SupplierDeliverySchedule | null; error: string | null };

/** A group of customers sharing one schedule. `id` is a stable client-only key. */
type GroupState = { id: string; customerIds: string[]; seedRaw: unknown };

type RowProps = {
  groupId: string;
  customerIds: string[];
  nameById: Map<string, string>;
  availableCustomers: CustomerOption[];
  initialScheduleRaw: unknown;
  presets: DeliveryPresetOption[];
  onChange: (groupId: string, report: RowReport) => void;
  onRemoveGroup: (groupId: string) => void;
  onAddCustomer: (groupId: string, customerId: string) => void;
  onRemoveCustomer: (groupId: string, customerId: string) => void;
};

function CustomerOverrideRow({
  groupId,
  customerIds,
  nameById,
  availableCustomers,
  initialScheduleRaw,
  presets,
  onChange,
  onRemoveGroup,
  onAddCustomer,
  onRemoveCustomer,
}: RowProps) {
  const form = useSupplierDeliveryScheduleForm(initialScheduleRaw);
  const { buildDeliverySchedulePayload, validateScheduleForSubmit } = form;

  useEffect(() => {
    onChange(groupId, {
      schedule: buildDeliverySchedulePayload(),
      error: validateScheduleForSubmit(),
    });
  }, [groupId, buildDeliverySchedulePayload, validateScheduleForSubmit, onChange]);

  return (
    <div className="rounded-md border border-border/70 bg-muted/10 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
          Customers
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-1.5 text-[10px] text-destructive"
          onClick={() => onRemoveGroup(groupId)}
        >
          Remove group
        </Button>
      </div>
      {customerIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {customerIds.map((cid) => (
            <span
              key={cid}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
            >
              {nameById.get(cid) ?? cid}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-[10px] leading-none cursor-pointer"
                onClick={() => onRemoveCustomer(groupId, cid)}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      <Select
        value=""
        onValueChange={(v) => onAddCustomer(groupId, v)}
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
      <SupplierDeliveryScheduleFields
        form={form}
        radioName={`cust-delivery-rule-${groupId}`}
        presets={presets}
        intro={
          <p className="text-[10px] text-muted-foreground -mt-0.5">
            Overrides this supplier&apos;s default for the customers above.
            &ldquo;Off&rdquo; removes the override on save.
          </p>
        }
      />
    </div>
  );
}

type Props = {
  customers: CustomerOption[];
  presets: DeliveryPresetOption[];
  /** Existing per-customer overrides for the supplier being edited. */
  initialOverrides: CustomerScheduleOverrideInput[];
  /** Supplier default schedule (raw) used to seed a newly-added override group. */
  supplierDefaultScheduleRaw: unknown;
};

/** Group existing per-customer overrides by identical schedule so they edit together. */
function groupInitialOverrides(
  initial: CustomerScheduleOverrideInput[],
): { customerIds: string[]; seedRaw: unknown }[] {
  const bySig = new Map<string, { customerIds: string[]; seedRaw: unknown }>();
  for (const o of initial) {
    const parsed = parseSupplierDeliverySchedule(o.schedule);
    const sig = parsed ? JSON.stringify(parsed) : `__raw__:${JSON.stringify(o.schedule)}`;
    const g = bySig.get(sig);
    if (g) g.customerIds.push(o.customerId);
    else bySig.set(sig, { customerIds: [o.customerId], seedRaw: parsed ?? o.schedule });
  }
  return [...bySig.values()];
}

export const SupplierCustomerScheduleOverrides = forwardRef<
  CustomerScheduleOverridesHandle,
  Props
>(function SupplierCustomerScheduleOverrides(
  { customers, presets, initialOverrides, supplierDefaultScheduleRaw },
  ref,
) {
  const idCounter = useRef(0);
  const [groups, setGroups] = useState<GroupState[]>(() =>
    groupInitialOverrides(initialOverrides).map((g, i) => ({
      id: `g${i}`,
      customerIds: g.customerIds,
      seedRaw: g.seedRaw,
    })),
  );
  const reportsRef = useRef<Map<string, RowReport>>(new Map());

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(c.id, c.name);
    return m;
  }, [customers]);

  const usedIds = useMemo(
    () => new Set(groups.flatMap((g) => g.customerIds)),
    [groups],
  );
  const availableCustomers = useMemo(
    () => customers.filter((c) => !usedIds.has(c.id)),
    [customers, usedIds],
  );

  const handleRowChange = useCallback((groupId: string, report: RowReport) => {
    reportsRef.current.set(groupId, report);
  }, []);

  const handleRemoveGroup = useCallback((groupId: string) => {
    reportsRef.current.delete(groupId);
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
  }, []);

  const handleAddCustomer = useCallback((groupId: string, customerId: string) => {
    if (!customerId) return;
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId && !g.customerIds.includes(customerId)
          ? { ...g, customerIds: [...g.customerIds, customerId] }
          : g,
      ),
    );
  }, []);

  const handleRemoveCustomer = useCallback(
    (groupId: string, customerId: string) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? { ...g, customerIds: g.customerIds.filter((c) => c !== customerId) }
            : g,
        ),
      );
    },
    [],
  );

  const handleAddGroup = useCallback(() => {
    setGroups((prev) => [
      ...prev,
      { id: `new${idCounter.current++}`, customerIds: [], seedRaw: supplierDefaultScheduleRaw },
    ]);
  }, [supplierDefaultScheduleRaw]);

  useImperativeHandle(
    ref,
    () => ({
      collect: () => {
        const out: { customerId: string; schedule: SupplierDeliverySchedule }[] = [];
        for (const g of groups) {
          if (g.customerIds.length === 0) continue;
          const report = reportsRef.current.get(g.id);
          if (!report) continue;
          if (report.error) {
            return { rows: [], error: `Customer override: ${report.error}` };
          }
          // "Off" → no schedule → drop the override (handled as a removal on save).
          if (!report.schedule) continue;
          for (const cid of g.customerIds) {
            out.push({ customerId: cid, schedule: report.schedule });
          }
        }
        return { rows: out, error: null };
      },
    }),
    [groups],
  );

  return (
    <div className="grid gap-2 rounded-md border border-border/60 p-2.5">
      <Label className="text-xs">Customer-specific delivery overrides</Label>
      <p className="text-[10px] text-muted-foreground -mt-0.5">
        Set a different expected-delivery schedule for specific customers ordering
        from this supplier. Group several customers that share one schedule.
        Customers without an override use the supplier default above.
      </p>

      {groups.length > 0 && (
        <div className="flex flex-col gap-2">
          {groups.map((g) => (
            <CustomerOverrideRow
              key={g.id}
              groupId={g.id}
              customerIds={g.customerIds}
              nameById={nameById}
              availableCustomers={availableCustomers}
              initialScheduleRaw={g.seedRaw}
              presets={presets}
              onChange={handleRowChange}
              onRemoveGroup={handleRemoveGroup}
              onAddCustomer={handleAddCustomer}
              onRemoveCustomer={handleRemoveCustomer}
            />
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-fit text-[10px]"
        onClick={handleAddGroup}
        disabled={availableCustomers.length === 0 && groups.length > 0}
      >
        Add override group
      </Button>
    </div>
  );
});
