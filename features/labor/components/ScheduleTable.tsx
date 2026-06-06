'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ScheduleTable as ScheduleTableModel } from '@/features/labor/engine';
import { heatStyle, hourLabel, hrs, shiftRangeLabel, usd } from './format';

type Props = {
  table: ScheduleTableModel;
  wage: number;
  ptLaborFee: number;
  affordableHrs: number;
};

/** Cycle a cell on click: empty → 1 → 0.5 → empty (0.5 = half-hour edge). */
function nextCellValue(v: number): number {
  if (v === 0) return 1;
  if (v === 1) return 0.5;
  return 0;
}

/**
 * Renders the recommended schedule exactly like the manager's spreadsheet:
 * hours down the rows, one shift per (unnamed) column, a heat-scaled "Total"
 * column, and a bottom "Hours" row. Cells are editable for hand-tuning; the
 * footer (hours, cost, variance, utilization) recomputes live from edits.
 */
export function ScheduleTable({ table, wage, ptLaborFee, affordableHrs }: Props) {
  const [cells, setCells] = useState<number[][]>(table.cells);

  // Re-sync when a new plan is generated.
  useEffect(() => {
    setCells(table.cells);
  }, [table]);

  const { hours, shifts } = table;

  const totalPerHour = useMemo(
    () => cells.map((row) => row.reduce((a, b) => a + b, 0)),
    [cells],
  );
  const hoursPerShift = useMemo(
    () =>
      shifts.map((_, col) =>
        cells.reduce((sum, row) => sum + (row[col] ?? 0), 0),
      ),
    [cells, shifts],
  );
  const maxTotal = Math.max(1, ...totalPerHour);

  const scheduledHrs = hoursPerShift.reduce((a, b) => a + b, 0);
  const cost = scheduledHrs * wage;
  const variance = ptLaborFee - cost;
  const utilization = affordableHrs > 0 ? scheduledHrs / affordableHrs : 0;

  function toggle(rowIdx: number, colIdx: number) {
    setCells((prev) => {
      const next = prev.map((r) => r.slice());
      next[rowIdx][colIdx] = nextCellValue(next[rowIdx][colIdx]);
      return next;
    });
  }

  if (shifts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No shifts were generated for this plan.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="border-collapse text-center text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-background px-3 py-2 text-left font-medium">
                Hour
              </th>
              {shifts.map((s, i) => (
                <th
                  key={i}
                  className="min-w-16 border-l px-2 py-2 font-medium"
                  title={shiftRangeLabel(s.startHour, s.endHour)}
                >
                  <div className="text-muted-foreground">{i + 1}</div>
                  <div className="text-[10px] font-normal text-muted-foreground">
                    {shiftRangeLabel(s.startHour, s.endHour)}
                  </div>
                </th>
              ))}
              <th className="border-l px-3 py-2 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h, rowIdx) => (
              <tr key={h} className="border-t">
                <td className="sticky left-0 z-10 bg-background px-3 py-1.5 text-left text-muted-foreground">
                  {hourLabel(h)}
                </td>
                {shifts.map((_, colIdx) => {
                  const v = cells[rowIdx]?.[colIdx] ?? 0;
                  return (
                    <td key={colIdx} className="border-l p-0">
                      <button
                        type="button"
                        onClick={() => toggle(rowIdx, colIdx)}
                        className={cn(
                          'h-full w-full px-2 py-1.5 tabular-nums transition-colors',
                          v === 1 &&
                            'bg-emerald-500/80 font-semibold text-white hover:bg-emerald-500',
                          v === 0.5 &&
                            'bg-emerald-300/70 font-medium text-emerald-950 hover:bg-emerald-300',
                          v === 0 && 'text-muted-foreground/40 hover:bg-accent',
                        )}
                      >
                        {v === 0 ? '·' : v}
                      </button>
                    </td>
                  );
                })}
                <td
                  className="border-l px-3 py-1.5 font-semibold tabular-nums"
                  style={heatStyle(totalPerHour[rowIdx], maxTotal)}
                >
                  {totalPerHour[rowIdx] || ''}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 font-medium">
              <td className="sticky left-0 z-10 bg-background px-3 py-2 text-left">
                Hours
              </td>
              {hoursPerShift.map((h, i) => (
                <td key={i} className="border-l px-2 py-2 tabular-nums">
                  {h}
                </td>
              ))}
              <td className="border-l px-3 py-2 tabular-nums">{scheduledHrs}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="PT hours" value={hrs(scheduledHrs)} />
        <Stat label="PT cost" value={usd(cost)} />
        <Stat label="Budget (PT fee)" value={usd(ptLaborFee)} />
        <Stat
          label="Variance"
          value={usd(variance)}
          tone={variance < 0 ? 'bad' : 'good'}
        />
        <Stat
          label="Utilization"
          value={`${Math.round(utilization * 100)}%`}
        />
      </dl>
      <p className="text-xs text-muted-foreground">
        Click a cell to edit: empty → 1 → 0.5 → empty. Column headers are left
        blank for the manager to assign names.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'font-semibold tabular-nums',
          tone === 'bad' && 'text-destructive',
          tone === 'good' && 'text-emerald-600',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
