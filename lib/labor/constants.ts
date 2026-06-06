/**
 * Labor module constants. Operational values that the business may change are
 * env-overridable — never hardcode a legal figure that drifts (e.g. BC minimum
 * wage rises every June).
 */

/** Trailing window for the sales heatmap (weeks). */
export const HEATMAP_TRAILING_WEEKS = 8;

/** Below this many valid samples, a heatmap cell is flagged low-confidence. */
export const LOW_CONFIDENCE_SAMPLE_N = 3;

/** Fraction trimmed from each tail of a cell's samples for the trimmed mean. */
export const TRIM_FRACTION = 0.2;

/**
 * BC minimum wage floor used only to *warn* when a configured wage is below it.
 * Configurable because it changes annually; never used as a hard value.
 * As of 2025-06-01 BC general minimum wage is $17.85/hr.
 */
export function getBcMinimumWage(): number {
  const raw = Number.parseFloat(process.env.BC_MINIMUM_WAGE ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : 17.85;
}

/** Engine/setting defaults when a location has no `labor_settings` row yet. */
export const LABOR_SETTINGS_DEFAULTS = {
  budgetPct: 0.25,
  wage: 17.85,
  minCov: 1,
  maxCov: 6,
  minShiftHrs: 3,
  maxShiftHrs: 6,
  increment: 1.0,
  openHour: 5,
  closeHour: 22,
} as const;
