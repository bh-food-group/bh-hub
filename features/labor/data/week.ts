/**
 * Weekly rollup (secondary to the daily flow): run the cascade + engine for each
 * of the 7 days from `weekStart` and sum them. Built on top of generatePlan so
 * the daily and weekly numbers can never diverge.
 */
import { addDays, format, parseISO } from 'date-fns';
import { generatePlan, isValidDate, type PlanResult } from './plan';

export type WeekDay = {
  date: string;
  status: PlanResult['status'];
  laborBudget: number;
  fixedPayroll: number;
  ptLaborFee: number;
  affordableHrs: number;
  scheduledHrs: number;
  scheduledCost: number;
  forecastMissing: boolean;
  fixedPayrollMissing: boolean;
};

export type WeekRollup = {
  weekStart: string;
  days: WeekDay[];
  totals: {
    laborBudget: number;
    fixedPayroll: number;
    ptLaborFee: number;
    affordableHrs: number;
    scheduledHrs: number;
    scheduledCost: number;
  };
};

export async function generateWeek(
  locationId: string,
  weekStart: string,
): Promise<WeekRollup> {
  if (!isValidDate(weekStart)) {
    throw new Error('weekStart must be YYYY-MM-DD');
  }
  const dates = Array.from({ length: 7 }, (_, i) =>
    format(addDays(parseISO(weekStart), i), 'yyyy-MM-dd'),
  );

  const days: WeekDay[] = [];
  for (const date of dates) {
    const plan = await generatePlan(locationId, date);
    days.push({
      date,
      status: plan.status,
      laborBudget: plan.cascade.laborBudget,
      fixedPayroll: plan.cascade.fixedPayroll,
      ptLaborFee: Math.max(0, plan.cascade.ptLaborFee),
      affordableHrs: plan.engine?.coverage.affordableHrs ?? 0,
      scheduledHrs: plan.engine?.table.footer.totalPtHours ?? 0,
      scheduledCost: plan.engine?.table.footer.totalPtCost ?? 0,
      forecastMissing: plan.forecastMissing,
      fixedPayrollMissing: plan.fixedPayrollMissing,
    });
  }

  const totals = days.reduce(
    (acc, d) => ({
      laborBudget: acc.laborBudget + d.laborBudget,
      fixedPayroll: acc.fixedPayroll + d.fixedPayroll,
      ptLaborFee: acc.ptLaborFee + d.ptLaborFee,
      affordableHrs: acc.affordableHrs + d.affordableHrs,
      scheduledHrs: acc.scheduledHrs + d.scheduledHrs,
      scheduledCost: acc.scheduledCost + d.scheduledCost,
    }),
    {
      laborBudget: 0,
      fixedPayroll: 0,
      ptLaborFee: 0,
      affordableHrs: 0,
      scheduledHrs: 0,
      scheduledCost: 0,
    },
  );

  return { weekStart, days, totals };
}
