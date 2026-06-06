/**
 * Orchestrates a daily plan. Forecast and fixed payroll are entered MONTHLY and
 * distributed to the day (weekday-weighted revenue, evenly-spread payroll) before
 * the Stage B cascade and the pure Stage C engine run. The engine stays pure;
 * this module is the DB-facing seam.
 */
import { prisma } from '@/lib/core';
import { zonedWeekdaySun0ForIsoDate, getCloverReportTimeZone } from '@/lib/clover/report-timezone';
import {
  runEngine,
  type EnginePlan,
  type LaborEngineSettings,
} from '@/features/labor/engine';
import {
  getLaborSettings,
  toEngineSettings,
  type ResolvedLaborSettings,
} from './settings';
import { salesVectorForDow, weekdayDailyAverages } from './heatmap';
import { computeBudgetCascade, type BudgetCascade } from './budget';
import {
  dailyFixedPayrollShare,
  dailyForecastShare,
  monthWeekdayCounts,
  yearMonthOf,
} from './distribution';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t);
}

export type MonthlyInputs = {
  yearMonth: string;
  revenueForecast: number;
  fixedPayroll: number;
  forecastMissing: boolean;
  fixedPayrollMissing: boolean;
};

export async function getMonthlyInputs(
  locationId: string,
  yearMonth: string,
): Promise<MonthlyInputs> {
  const [forecastRow, payrollRow] = await Promise.all([
    prisma.revenueForecast.findUnique({
      where: { locationId_yearMonth: { locationId, yearMonth } },
      select: { amount: true },
    }),
    prisma.fixedPayroll.findUnique({
      where: { locationId_yearMonth: { locationId, yearMonth } },
      select: { amount: true },
    }),
  ]);
  return {
    yearMonth,
    revenueForecast: forecastRow ? Number(forecastRow.amount) : 0,
    fixedPayroll: payrollRow ? Number(payrollRow.amount) : 0,
    forecastMissing: !forecastRow,
    fixedPayrollMissing: !payrollRow,
  };
}

export type PlanResult = {
  date: string;
  dow: number;
  yearMonth: string;
  cascade: BudgetCascade;
  /** Monthly inputs the day's numbers were derived from. */
  monthlyForecast: number;
  monthlyFixedPayroll: number;
  /** Day's distributed share of the monthly inputs. */
  dailyForecast: number;
  dailyFixedPayroll: number;
  engine?: EnginePlan;
  sales: { s: number[]; sampleN: number[] };
  settings: LaborEngineSettings;
  status: 'DRAFT' | 'OVER_BUDGET' | 'BLOCKED';
  shortfall?: number;
  planId: string | null;
  forecastMissing: boolean;
  fixedPayrollMissing: boolean;
};

/** Single-day plan (computes its own shared inputs). */
export async function generatePlan(
  locationId: string,
  date: string,
): Promise<PlanResult> {
  const yearMonth = yearMonthOf(date);
  const [resolved, weekdayDailyAvg, monthly] = await Promise.all([
    getLaborSettings(locationId),
    weekdayDailyAverages(locationId),
    getMonthlyInputs(locationId, yearMonth),
  ]);
  return runDayPlan({
    locationId,
    date,
    resolved,
    weekdayDailyAvg,
    monthly,
    monthCounts: monthWeekdayCounts(yearMonth),
  });
}

/** Core per-day plan with shared inputs supplied by the caller. */
export async function runDayPlan(params: {
  locationId: string;
  date: string;
  resolved: ResolvedLaborSettings;
  weekdayDailyAvg: number[];
  monthly: MonthlyInputs;
  monthCounts: number[];
}): Promise<PlanResult> {
  const { locationId, date, resolved, weekdayDailyAvg, monthly, monthCounts } =
    params;
  const tz = getCloverReportTimeZone();
  const dow = zonedWeekdaySun0ForIsoDate(date, tz);
  const settings = toEngineSettings(resolved);

  const sales = await salesVectorForDow(locationId, dow);

  const dailyForecast = dailyForecastShare({
    monthlyForecast: monthly.revenueForecast,
    dow,
    weekdayDailyAvg,
    monthCounts,
  });
  const dailyFixedPayroll = dailyFixedPayrollShare(
    monthly.fixedPayroll,
    monthly.yearMonth,
  );

  const cascade = computeBudgetCascade({
    revenueForecast: dailyForecast,
    fixedPayroll: dailyFixedPayroll,
    budgetPct: resolved.budgetPct,
    wage: resolved.wage,
  });

  const base = {
    date,
    dow,
    yearMonth: monthly.yearMonth,
    cascade,
    monthlyForecast: monthly.revenueForecast,
    monthlyFixedPayroll: monthly.fixedPayroll,
    dailyForecast,
    dailyFixedPayroll,
    sales,
    settings,
    forecastMissing: monthly.forecastMissing,
    fixedPayrollMissing: monthly.fixedPayrollMissing,
  };

  // Edge case: payroll consumes the whole budget → block, don't persist.
  if (cascade.blocked) {
    return {
      ...base,
      status: 'BLOCKED',
      shortfall: cascade.shortfall,
      planId: null,
    };
  }

  const engine = runEngine(sales.s, cascade.ptLaborFee, settings);
  const status: 'DRAFT' | 'OVER_BUDGET' =
    engine.status === 'OVER_BUDGET' ? 'OVER_BUDGET' : 'DRAFT';

  const planId = await persistPlan({
    locationId,
    date,
    cascade,
    resolvedWage: resolved.wage,
    engine,
    sales,
    status,
  });

  return { ...base, engine, status, planId };
}

async function persistPlan(args: {
  locationId: string;
  date: string;
  cascade: BudgetCascade;
  resolvedWage: number;
  engine: EnginePlan;
  sales: { s: number[]; sampleN: number[] };
  status: string;
}): Promise<string> {
  const { locationId, date, cascade, resolvedWage, engine, sales, status } =
    args;
  const { table, coverage } = engine;

  return prisma.$transaction(async (tx) => {
    // One plan per (location, date): clear the prior plan first (cascades to
    // shifts + coverage).
    await tx.laborPlan.deleteMany({ where: { locationId, date } });

    const plan = await tx.laborPlan.create({
      data: {
        locationId,
        date,
        laborBudget: cascade.laborBudget,
        fixedPayroll: cascade.fixedPayroll,
        ptLaborFee: cascade.ptLaborFee,
        wageUsed: resolvedWage,
        affordableHrs: coverage.affordableHrs,
        scheduledHrs: table.footer.totalPtHours,
        scheduledCost: table.footer.totalPtCost,
        status,
      },
      select: { id: true },
    });

    if (engine.shifts.length > 0) {
      await tx.laborPlanShift.createMany({
        data: engine.shifts.map((sh, i) => ({
          planId: plan.id,
          shiftIndex: i,
          startHour: sh.startHour,
          endHour: sh.endHour,
          role: null,
        })),
      });
    }

    await tx.laborPlanCoverage.createMany({
      data: table.hours.map((hour, i) => ({
        planId: plan.id,
        hour,
        targetHeadcount: coverage.cov[i],
        salesWeight: coverage.weights[i],
        salesAvg: sales.s[i],
      })),
    });

    return plan.id;
  });
}
