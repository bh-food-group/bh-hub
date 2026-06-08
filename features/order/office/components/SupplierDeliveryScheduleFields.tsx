'use client';

import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import {
  ISO_WEEKDAY_OPTIONS,
  type SupplierDeliveryScheduleForm,
} from '../hooks/use-supplier-delivery-schedule-form';
import { PartitionWindowsEditor } from './PartitionWindowsEditor';

export type DeliveryPresetOption = { id: string; name: string };

type Props = {
  form: SupplierDeliveryScheduleForm;
  /** Unique `name` for radio inputs (avoid clashes when multiple forms exist). */
  radioName: string;
  intro?: ReactNode;
  /** Selectable shared presets. When empty, the preset option is hidden. */
  presets?: DeliveryPresetOption[];
};

export function SupplierDeliveryScheduleFields({
  form,
  radioName,
  intro,
  presets = [],
}: Props) {
  const {
    deliveryRuleKind,
    deliveryWeekdays,
    partitionWindows,
    setPartitionWindows,
    presetId,
    selectOff,
    selectNext,
    selectDayAfterCreation,
    selectPreset,
    selectPartition,
    toggleDeliveryWeekday,
  } = form;

  return (
    <div className="grid gap-2 rounded-md border border-border/60 p-2.5">
      <Label className="text-xs">PO default — expected delivery</Label>
      {intro ?? (
        <p className="text-[10px] text-muted-foreground -mt-0.5">
          Used in the inbox when creating a PO (reference = latest order date in
          the row, or today). BH split is only a template — partition rows are
          saved on this supplier.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="radio"
            name={radioName}
            className="h-3 w-3"
            checked={deliveryRuleKind === 'off'}
            onChange={selectOff}
          />
          Off (no schedule)
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="radio"
            name={radioName}
            className="h-3 w-3"
            checked={deliveryRuleKind === 'next'}
            onChange={selectNext}
          />
          Next delivery day after reference (pick weekdays below)
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="radio"
            name={radioName}
            className="h-3 w-3"
            checked={deliveryRuleKind === 'day_after_creation'}
            onChange={selectDayAfterCreation}
          />
          Day after PO is created (Vancouver calendar)
        </label>
        {presets.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="radio"
              name={radioName}
              className="h-3 w-3"
              checked={deliveryRuleKind === 'preset'}
              onChange={() => selectPreset(presetId ?? presets[0].id)}
            />
            Shared preset (e.g. BH Shipping)
          </label>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="radio"
            name={radioName}
            className="h-3 w-3"
            checked={deliveryRuleKind === 'partition'}
            onChange={selectPartition}
          />
          Weekly partitions (ISO weeks)
        </label>
      </div>
      {deliveryRuleKind === 'preset' && presets.length > 0 && (
        <div className="pt-1">
          <Select value={presetId ?? ''} onValueChange={selectPreset}>
            <SelectTrigger className="h-7 text-[10px] px-2">
              <SelectValue placeholder="Select a preset…" />
            </SelectTrigger>
            <SelectContent>
              {presets.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground pt-1">
            Centrally managed — edit the preset to update every supplier using it.
            Per-customer exceptions are configured on the preset.
          </p>
        </div>
      )}
      {deliveryRuleKind === 'next' && (
        <div className="flex flex-wrap gap-1 pt-1">
          {ISO_WEEKDAY_OPTIONS.map(({ value, label }) => {
            const on = deliveryWeekdays.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleDeliveryWeekday(value)}
                className={cn(
                  'rounded border px-2 py-0.5 text-[10px] font-medium transition-colors',
                  on
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {deliveryRuleKind === 'partition' && (
        <PartitionWindowsEditor
          windows={partitionWindows}
          onChange={setPartitionWindows}
        />
      )}
    </div>
  );
}
