/**
 * Orchestrates a daily plan: read inputs (heatmap row, forecast, fixed payroll),
 * run the budget cascade (Stage B) and the pure engine (Stage C), then persist
 * `labor_plans` + shifts + coverage. The engine stays pure; this module is the
 * DB-facing seam.
 */
import { prisma } from '@/lib/core';
import { zonedWeekdaySun0ForIsoDate, getCloverReportTimeZone } from '@/lib/clover/report-timezone';
import {
  runEngine,
  type EnginePlan,
  type LaborEngineSettings,
} from '@/features/labor/engine';
import { getLaborSettings, toEngineSettings } from './settings';
import { salesVectorForDow } from './heatmap';
import { computeBudgetCascade, type BudgetCascade } from './budget';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t);
}

export type PlanResult = {
  date: string;
  dow: number;
  cascade: BudgetCascade;
  /** Present unless the plan was blocked by an unaffordable baseline payroll. */
  engine?: EnginePlan;
  /** Per-operating-hour sales averages and sample counts used as engine input. */
  sales: { s: number[]; sampleN: number[] };
  settings: LaborEngineSettings;
  /** DRAFT | OVER_BUDGET | BLOCKED (PUBLISHED only after an explicit publish). */
  status: 'DRAFT' | 'OVER_BUDGET' | 'BLOCKED';
  /** Set when status === 'BLOCKED'. */
  shortfall?: number;
  /** Persisted plan id (null when blocked — nothing is stored). */
  planId: string | null;
  forecastMissing: boolean;
  fixedPayrollMissing: boolean;
};

/**
 * Generate (and persist) the plan for one location + date. Persists nothing when
 * blocked. Re-running replaces the prior plan for that date.
 */
export async function generatePlan(
  locationId: string,
  date: string,
): Promise<PlanResult> {
  const tz = getCloverReportTimeZone();
  const dow = zonedWeekdaySun0ForIsoDate(date, tz);

  const resolved = await getLaborSettings(locationId);
  const settings = toEngineSettings(resolved);

  const [sales, forecastRow, payrollRow] = await Promise.all([
    salesVectorForDow(locationId, dow),
    prisma.revenueForecast.findUnique({
      where: { locationId_date: { locationId, date } },
      select: { amount: true },
    }),
    prisma.fixedPayroll.findUnique({
      where: { locationId_date: { locationId, date } },
      select: { amount: true },
    }),
  ]);

  const revenueForecast = forecastRow
    ? Number.parseFloat(forecastRow.amount.toString())
    : 0;
  const fixedPayroll = payrollRow
    ? Number.parseFloat(payrollRow.amount.toString())
    : 0;

  const cascade = computeBudgetCascade({
    revenueForecast,
    fixedPayroll,
    budgetPct: resolved.budgetPct,
    wage: resolved.wage,
  });

  const base = {
    date,
    dow,
    cascade,
    sales,
    settings,
    forecastMissing: !forecastRow,
    fixedPayrollMissing: !payrollRow,
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
