import { operatingHours } from './operating-hours';
import type { CoverageResult, LaborEngineSettings } from './types';

/**
 * Stage C1 — deterministic coverage curve.
 *
 * Given the per-operating-hour sales weights, decide how many staff-hours sit in
 * each hour, spending up to (but never above) the PT labor fee. Everything is
 * accounted in integer `inc`-sized units to avoid float drift, then scaled by
 * `inc` at the end.
 *
 * Tie-breaking is fixed so identical inputs always produce an identical curve
 * (acceptance criterion #7): leftover units go to the largest fractional
 * remainder, then higher sales, then earlier hour.
 *
 * @param s sales (avg net sales) per operating hour, aligned to operatingHours()
 * @param ptLaborFee dollars available for PT labor on this day
 */
export function computeCoverage(
  s: number[],
  ptLaborFee: number,
  settings: LaborEngineSettings,
): CoverageResult {
  const { wage, minCov, maxCov, inc } = settings;
  const O = operatingHours(settings);
  const n = O.length;

  // Defensive: nothing to schedule.
  if (n === 0 || inc <= 0 || wage <= 0) {
    return {
      cov: new Array(n).fill(0),
      weights: new Array(n).fill(0),
      affordableHrs: 0,
      status: 'OK',
      overage: 0,
      weightsFallback: false,
    };
  }

  // Align the sales vector to the operating-hour count (pad/truncate defensively).
  const sales = O.map((_, i) => (Number.isFinite(s[i]) ? Math.max(0, s[i]) : 0));

  // --- Step 1: affordable units -------------------------------------------------
  const affordableUnits = Math.floor(ptLaborFee / wage / inc);
  const affordableHrs = affordableUnits * inc;

  // --- Step 2: sales weights ----------------------------------------------------
  const totalS = sales.reduce((a, b) => a + b, 0);
  const weightsFallback = totalS <= 0;
  const weights = weightsFallback
    ? new Array(n).fill(1 / n)
    : sales.map((v) => v / totalS);

  // Coverage tracked in integer units; cov[h] hours = units[h] * inc.
  const minCovUnits = Math.round(minCov / inc);
  const maxCovUnits = Math.round(maxCov / inc);
  const units = new Array<number>(n).fill(minCovUnits);

  const baselineUnits = minCovUnits * n;
  const baselineHrs = baselineUnits * inc;

  // --- Step 4: over-budget baseline ---------------------------------------------
  if (affordableHrs < baselineHrs) {
    const overage = baselineHrs * wage - ptLaborFee;
    return {
      cov: units.map((u) => u * inc),
      weights,
      affordableHrs,
      status: 'OVER_BUDGET',
      overage: Math.max(0, overage),
      weightsFallback,
    };
  }

  // --- Step 5: distribute remaining units by weight (largest remainder) ---------
  const remainingUnits = affordableUnits - baselineUnits;
  const capacity = units.map(() => maxCovUnits - minCovUnits); // unit room per hour

  const raw = weights.map((w) => remainingUnits * w);
  const floors = raw.map((r, i) => Math.min(Math.floor(r), capacity[i]));
  for (let i = 0; i < n; i++) units[i] += floors[i];

  const placed = floors.reduce((a, b) => a + b, 0);
  let leftover = remainingUnits - placed;

  // Order hours by fractional remainder desc, then higher sales, then earlier hour.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r), s: sales[i] }))
    .sort(
      (a, b) =>
        b.frac - a.frac || b.s - a.s || a.i - b.i,
    )
    .map((o) => o.i);

  // Hand out leftover units one at a time, skipping hours already at capacity.
  // Multiple passes in case capacity caps force units onto fewer hours.
  while (leftover > 0) {
    let progressed = false;
    for (const i of order) {
      if (leftover <= 0) break;
      if (units[i] - minCovUnits < capacity[i]) {
        units[i] += 1;
        leftover -= 1;
        progressed = true;
      }
    }
    if (!progressed) break; // every hour at max_cov; budget cannot be fully spent
  }

  return {
    cov: units.map((u) => u * inc),
    weights,
    affordableHrs,
    status: 'OK',
    overage: 0,
    weightsFallback,
  };
}
