import { buildScheduleTable } from './build-table';
import { computeCoverage } from './compute-coverage';
import { packShifts } from './pack-shifts';
import type { EnginePlan, LaborEngineSettings } from './types';

/**
 * Run the full pipeline: coverage curve (C1) → shift packing (C2) → table (C3).
 *
 * The table's "Total" column reflects the *realized* coverage (sum of shift
 * cells), which may dip below the C1 target where a narrow peak was dropped for
 * lacking a real-length shift. That is intentional and stays within one `inc` of
 * the target (acceptance criterion #3).
 *
 * @param s avg net sales per operating hour, aligned to operatingHours()
 * @param ptLaborFee dollars available for PT labor on the day
 */
export function runEngine(
  s: number[],
  ptLaborFee: number,
  settings: LaborEngineSettings,
): EnginePlan {
  const coverage = computeCoverage(s, ptLaborFee, settings);
  const shifts = packShifts(coverage.cov, s, settings);
  const table = buildScheduleTable(shifts, settings, {
    ptLaborFee,
    affordableHrs: coverage.affordableHrs,
  });

  return {
    coverage,
    shifts,
    table,
    status: coverage.status,
  };
}
