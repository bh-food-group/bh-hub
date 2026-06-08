/**
 * Weekly generation. `generateWeekPlans` runs the full engine for each of the 7
 * days (shared inputs computed once) and returns the complete plans — this backs
 * the Schedule screen's per-day tabs. `generateWeek` derives the lightweight
 * budget rollup from the same plans so daily and weekly numbers never diverge.
 */
import { addDays, format, parseISO } from 'date-fns';
import { getLaborSettings } from './settings';
import { holidayProfile, weekdayDailyAverages } from './heatmap';
import {
  buildMonthExpectations,
  yearMonthOf,
  type MonthExpectations,
} from './distribution';
import {
  getMonthlyInputs,
  runDayPlan,
  isValidDate,
  type MonthlyInputs,
  type PlanResult,
} from './plan';

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

/** The 7 ISO dates of the week starting at `weekStart`. */
function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    format(addDays(parseISO(weekStart), i), 'yyyy-MM-dd'),
  );
}

/**
 * Full plans for all 7 days. Settings + weekday averages are fetched once;
 * monthly inputs + weekday counts are fetched once per distinct month (a week may
 * straddle a month boundary).
 */
export async function generateWeekPlans(
  locationId: string,
  weekStart: string,
): Promise<PlanResult[]> {
  if (!isValidDate(weekStart)) {
    throw new Error('weekStart must be YYYY-MM-DD');
  }
  const dates = weekDates(weekStart);

  const [resolved, weekdayDailyAvg, hp] = await Promise.all([
    getLaborSettings(locationId),
    weekdayDailyAverages(locationId),
    holidayProfile(locationId),
  ]);

  // Cache monthly inputs + holiday-aware expectations per distinct year-month in
  // the week (a week may straddle a month boundary).
  const months = new Map<
    string,
    { monthly: MonthlyInputs; expectations: MonthExpectations }
  >();
  for (const ym of new Set(dates.map(yearMonthOf))) {
    months.set(ym, {
      monthly: await getMonthlyInputs(locationId, ym),
      expectations: buildMonthExpectations(ym, weekdayDailyAvg, hp.dailyAvg),
    });
  }

  const plans: PlanResult[] = [];
  for (const date of dates) {
    const month = months.get(yearMonthOf(date))!;
    plans.push(
      await runDayPlan({
        locationId,
        date,
        resolved,
        monthly: month.monthly,
        expectations: month.expectations,
      }),
    );
  }
  return plans;
}

export async function generateWeek(
  locationId: string,
  weekStart: string,
): Promise<WeekRollup> {
  const plans = await generateWeekPlans(locationId, weekStart);

  const days: WeekDay[] = plans.map((plan) => ({
    date: plan.date,
    status: plan.status,
    laborBudget: plan.cascade.laborBudget,
    fixedPayroll: plan.cascade.fixedPayroll,
    ptLaborFee: Math.max(0, plan.cascade.ptLaborFee),
    affordableHrs: plan.engine?.coverage.affordableHrs ?? 0,
    scheduledHrs: plan.engine?.table.footer.totalPtHours ?? 0,
    scheduledCost: plan.engine?.table.footer.totalPtCost ?? 0,
    forecastMissing: plan.forecastMissing,
    fixedPayrollMissing: plan.fixedPayrollMissing,
  }));

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
