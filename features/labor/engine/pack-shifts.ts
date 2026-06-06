import { operatingHours } from './operating-hours';
import type { LaborEngineSettings, Shift } from './types';

/**
 * Stage C2 — shift packing by layer filling.
 *
 * Cover `cov[h]` with the fewest continuous shifts, each within
 * [minShift, maxShift] hours, so the per-hour sum of shift cells equals the
 * realized coverage. Peeling horizontal layers from the bottom up reproduces the
 * spreadsheet's staircase: a long morning block, a long evening block.
 *
 * MVP assumes `inc = 1.0`, so coverage is integer-valued and every shift cell is
 * a full 1. (0.5 shift-edge smoothing is a v1.5 refinement — see the brief.)
 *
 * Long runs are split at the lowest-sales interior boundary (the AM→PM handoff,
 * usually the early-afternoon trough). Runs shorter than minShift cannot form a
 * real shift and are dropped (their budget is returned) rather than covered by a
 * stub shift — a peak you cannot staff with a real-length shift is flattened.
 */
export function packShifts(
  cov: number[],
  s: number[],
  settings: LaborEngineSettings,
): Shift[] {
  const { inc, minShift, maxShift } = settings;
  const O = operatingHours(settings);
  const n = O.length;
  if (n === 0) return [];

  const covUnits = cov.map((c) => Math.round(c / inc));
  const sales = O.map((_, i) => (Number.isFinite(s[i]) ? s[i] : 0));
  const maxUnits = covUnits.reduce((a, b) => Math.max(a, b), 0);

  const shifts: Shift[] = [];

  for (let layer = 1; layer <= maxUnits; layer++) {
    for (const run of contiguousRuns(covUnits, layer)) {
      const runLen = run.length;
      if (runLen < minShift) {
        // Too short to staff with a real shift → drop (return the budget).
        continue;
      }
      for (const piece of splitRun(run, sales, minShift, maxShift)) {
        const startIdx = piece[0];
        const endIdx = piece[piece.length - 1];
        shifts.push({ startHour: O[startIdx], endHour: O[endIdx] + 1 });
      }
    }
  }

  shifts.sort((a, b) => a.startHour - b.startHour || a.endHour - b.endHour);
  return shifts;
}

/** Maximal contiguous index ranges where `covUnits[i] >= layer`. */
function contiguousRuns(covUnits: number[], layer: number): number[][] {
  const runs: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < covUnits.length; i++) {
    if (covUnits[i] >= layer) {
      cur.push(i);
    } else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/**
 * Split a run (array of consecutive indices) into pieces each within
 * [minShift, maxShift], cutting at the lowest-sales interior boundary.
 * Deterministic: lowest sales at the cut bucket, then most-balanced split,
 * then earliest cut.
 */
function splitRun(
  run: number[],
  sales: number[],
  minShift: number,
  maxShift: number,
): number[][] {
  const len = run.length;
  if (len <= maxShift) return [run];

  // Left piece length p; right piece length len - p. Both must be >= minShift,
  // and the left piece must fit a single shift (<= maxShift). The right piece may
  // still be long — recursion handles it.
  const lo = minShift;
  const hi = Math.min(maxShift, len - minShift);

  let bestP = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestBalance = Number.POSITIVE_INFINITY;
  for (let p = lo; p <= hi; p++) {
    const cutBucketSales = sales[run[p]]; // bucket that begins the right piece
    const balance = Math.abs(p - len / 2);
    if (
      cutBucketSales < bestCost ||
      (cutBucketSales === bestCost && balance < bestBalance) ||
      (cutBucketSales === bestCost && balance === bestBalance && p < bestP)
    ) {
      bestP = p;
      bestCost = cutBucketSales;
      bestBalance = balance;
    }
  }

  if (bestP < 0) return [run]; // no feasible cut (shouldn't happen for len > maxShift)

  const left = run.slice(0, bestP);
  const right = run.slice(bestP);
  return [left, ...splitRun(right, sales, minShift, maxShift)];
}
