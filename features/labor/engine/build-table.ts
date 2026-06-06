import { operatingHours } from './operating-hours';
import type {
  LaborEngineSettings,
  ScheduleTable,
  Shift,
} from './types';

/**
 * Stage C3 — render the schedule table.
 *
 * Columns = shifts (sorted by start), rows = operating hours, cell = 1 when a
 * shift is on during that hour. The "Total" column is the per-hour sum
 * (concurrent staff = realized coverage); the bottom "Hours" row is the
 * per-shift hour total. The footer reports cost vs the PT labor fee.
 */
export function buildScheduleTable(
  shifts: Shift[],
  settings: LaborEngineSettings,
  opts: { ptLaborFee: number; affordableHrs: number },
): ScheduleTable {
  const { wage } = settings;
  const hours = operatingHours(settings);

  const cells: number[][] = hours.map((h) =>
    shifts.map((shift) => (h >= shift.startHour && h < shift.endHour ? 1 : 0)),
  );

  const totalPerHour = cells.map((row) => row.reduce((a, b) => a + b, 0));
  const hoursPerShift = shifts.map((shift) => shift.endHour - shift.startHour);

  const totalPtHours = hoursPerShift.reduce((a, b) => a + b, 0);
  const totalPtCost = totalPtHours * wage;
  const variance = opts.ptLaborFee - totalPtCost;
  const utilization =
    opts.affordableHrs > 0 ? totalPtHours / opts.affordableHrs : 0;

  return {
    hours,
    shifts,
    cells,
    totalPerHour,
    hoursPerShift,
    footer: {
      totalPtHours,
      totalPtCost,
      ptLaborFee: opts.ptLaborFee,
      variance,
      affordableHrs: opts.affordableHrs,
      utilization,
    },
  };
}
