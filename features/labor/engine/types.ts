/**
 * Pure scheduling engine types. No DB, React, or framework imports anywhere in
 * `features/labor/engine`. Inputs are plain numbers; outputs are plain data.
 *
 * All hours are integers 0-23 in store-local time (America/Vancouver). Operating
 * hours are the contiguous inclusive range [openHour .. closeHour]; the bucket
 * count is `closeHour - openHour + 1`. A store open "5 AM to 10 PM" has
 * openHour=5, closeHour=22 → 18 buckets (matching the manager's spreadsheet).
 */

/** Plan status mirrored into `labor_plans.status`. */
export type PlanStatus = 'OK' | 'OVER_BUDGET' | 'NO_HISTORY';

export type LaborEngineSettings = {
  /** Fixed PT wage per hour. */
  wage: number;
  /** Minimum staff on while open (default 1). */
  minCov: number;
  /** Physical cap on concurrent staff (default 6). */
  maxCov: number;
  /** Granularity of a coverage step in hours (1.0 for MVP, 0.5 supported in C1). */
  inc: number;
  /** Minimum continuous shift length, hours (default 3). */
  minShift: number;
  /** Maximum continuous shift length, hours (default 6). */
  maxShift: number;
  /** First operating hour bucket, inclusive (0-23). */
  openHour: number;
  /** Last operating hour bucket, inclusive (0-23). */
  closeHour: number;
};

export type CoverageResult = {
  /** Per-operating-hour target coverage in hours, aligned to `operatingHours`. */
  cov: number[];
  /** Sales weight per operating hour (sums to 1; uniform when total sales == 0). */
  weights: number[];
  /** Total hours buyable at the fixed wage: floor(fee/wage/inc) * inc. */
  affordableHrs: number;
  status: PlanStatus;
  /**
   * When status === 'OVER_BUDGET', the dollar amount by which the mandatory
   * baseline coverage exceeds the PT labor fee. Zero otherwise.
   */
  overage: number;
  /** True when sales history was all-zero and uniform weights were used. */
  weightsFallback: boolean;
};

/** A continuous shift = one column in the rendered table. */
export type Shift = {
  /** Inclusive start hour (0-23), store-local. */
  startHour: number;
  /** Exclusive end hour. A 8:00-14:00 shift has startHour=8, endHour=14. */
  endHour: number;
};

/** Fully realized table, ready to render exactly like the manager's spreadsheet. */
export type ScheduleTable = {
  /** Operating hour buckets, ascending (row order). */
  hours: number[];
  /** Shift columns, sorted by start time. Headers are intentionally unnamed. */
  shifts: Shift[];
  /**
   * cells[rowIndex][colIndex] = 1 (full hour), 0.5 (shift edge), or 0 (off).
   * rowIndex indexes `hours`, colIndex indexes `shifts`.
   */
  cells: number[][];
  /** Per-hour concurrent staff = row sum (the "Total" column). */
  totalPerHour: number[];
  /** Per-shift hour totals (the bottom "Hours" row). */
  hoursPerShift: number[];
  footer: ScheduleFooter;
};

export type ScheduleFooter = {
  totalPtHours: number;
  totalPtCost: number;
  /** PT labor fee the plan was built against (the budget). */
  ptLaborFee: number;
  /** ptLaborFee - totalPtCost. Negative means over budget. */
  variance: number;
  affordableHrs: number;
  /** totalPtHours / affordableHrs (0 when affordableHrs == 0). */
  utilization: number;
};

/** Top-level engine output. */
export type EnginePlan = {
  coverage: CoverageResult;
  shifts: Shift[];
  table: ScheduleTable;
  status: PlanStatus;
};
