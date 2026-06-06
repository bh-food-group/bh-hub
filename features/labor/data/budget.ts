/**
 * Stage B — budget cascade (per calendar day):
 *
 *   labor_budget   = revenue_forecast * budget_pct
 *   pt_labor_fee   = labor_budget - fixed_payroll
 *   affordable_hrs = pt_labor_fee / wage
 *
 * Pure arithmetic; no DB. The edge case (`fixed_payroll >= labor_budget`) is
 * surfaced as `blocked` with the shortfall so callers can refuse to generate a
 * schedule and warn, rather than silently produce an empty table.
 */

export type BudgetCascade = {
  revenueForecast: number;
  budgetPct: number;
  laborBudget: number;
  fixedPayroll: number;
  ptLaborFee: number;
  wage: number;
  affordableHrs: number;
  /** True when fixed payroll meets/exceeds the labor budget (fee <= 0). */
  blocked: boolean;
  /** When blocked: fixed_payroll - labor_budget (>= 0). */
  shortfall: number;
};

export function computeBudgetCascade(input: {
  revenueForecast: number;
  fixedPayroll: number;
  budgetPct: number;
  wage: number;
}): BudgetCascade {
  const { revenueForecast, fixedPayroll, budgetPct, wage } = input;
  const laborBudget = revenueForecast * budgetPct;
  const ptLaborFee = laborBudget - fixedPayroll;
  const blocked = ptLaborFee <= 0;
  const affordableHrs = wage > 0 ? Math.max(0, ptLaborFee) / wage : 0;
  return {
    revenueForecast,
    budgetPct,
    laborBudget,
    fixedPayroll,
    ptLaborFee,
    wage,
    affordableHrs,
    blocked,
    shortfall: blocked ? fixedPayroll - laborBudget : 0,
  };
}
