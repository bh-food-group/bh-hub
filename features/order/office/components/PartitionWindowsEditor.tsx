'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import type { IsoWeekWindow } from '@/lib/order/supplier-delivery-schedule';
import { ISO_WEEKDAY_OPTIONS } from '../hooks/use-supplier-delivery-schedule-form';

type Props = {
  windows: IsoWeekWindow[];
  onChange: (windows: IsoWeekWindow[]) => void;
};

/**
 * Controlled editor for `IsoWeekWindow[]` — the "weekly partitions" UI shared by the
 * supplier delivery schedule and the delivery-schedule preset editor. Each ISO order
 * weekday may belong to only one window (enforced here and server-side).
 */
export function PartitionWindowsEditor({ windows, onChange }: Props) {
  function addWindow() {
    onChange([
      ...windows,
      { orderWeekdays: [1], deliverWeekday: 5, deliverIn: 'same_iso_week' },
    ]);
  }

  function removeWindow(index: number) {
    if (windows.length <= 1) return;
    onChange(windows.filter((_, i) => i !== index));
  }

  function patchWindow(index: number, patch: Partial<IsoWeekWindow>) {
    onChange(windows.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  function toggleOrderDay(windowIndex: number, d: number) {
    onChange(
      windows.map((w, i) => {
        if (i !== windowIndex) return w;
        const has = w.orderWeekdays.includes(d);
        if (has) {
          return { ...w, orderWeekdays: w.orderWeekdays.filter((x) => x !== d) };
        }
        const takenElsewhere = windows.some(
          (other, j) => j !== windowIndex && other.orderWeekdays.includes(d),
        );
        if (takenElsewhere) return w;
        return {
          ...w,
          orderWeekdays: [...w.orderWeekdays, d].sort((a, b) => a - b),
        };
      }),
    );
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[10px]"
          onClick={addWindow}
        >
          Add window
        </Button>
      </div>
      {windows.map((win, wi) => (
        <div
          key={wi}
          className="rounded border border-border/70 bg-muted/20 p-2 space-y-2"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-semibold text-muted-foreground">
              Window {wi + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-1.5 text-destructive"
              disabled={windows.length <= 1}
              onClick={() => removeWindow(wi)}
            >
              Remove
            </Button>
          </div>
          <div>
            <span className="text-[9px] uppercase text-muted-foreground block mb-1">
              Order placed on (ISO weekday)
            </span>
            <div className="flex flex-wrap gap-1">
              {ISO_WEEKDAY_OPTIONS.map(({ value, label }) => {
                const on = win.orderWeekdays.includes(value);
                const takenElsewhere = windows.some(
                  (w, j) => j !== wi && w.orderWeekdays.includes(value),
                );
                const disabled = !on && takenElsewhere;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (!disabled) toggleOrderDay(wi, value);
                    }}
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[9px] font-medium transition-colors',
                      on
                        ? 'border-primary bg-primary text-primary-foreground'
                        : disabled
                          ? 'cursor-not-allowed border-border bg-muted/30 text-muted-foreground/50'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-[9px] text-muted-foreground">Deliver on</Label>
              <Select
                value={String(win.deliverWeekday)}
                onValueChange={(v) =>
                  patchWindow(wi, { deliverWeekday: Number(v) })
                }
              >
                <SelectTrigger className="h-7 text-[10px] px-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ISO_WEEKDAY_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={String(value)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-[9px] text-muted-foreground">Week</Label>
              <Select
                value={win.deliverIn}
                onValueChange={(v) =>
                  patchWindow(wi, {
                    deliverIn: v as 'same_iso_week' | 'next_iso_week',
                  })
                }
              >
                <SelectTrigger className="h-7 text-[10px] px-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="same_iso_week">This ISO week</SelectItem>
                  <SelectItem value="next_iso_week">Next ISO week</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
