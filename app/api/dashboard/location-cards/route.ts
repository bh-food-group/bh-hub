// GET /api/dashboard/location-cards?locationId=&yearMonth=YYYY-MM&phase=1|2
//
// phase=1 (fast ~150ms): DB-only — budget structure, revenue targets, labor target.
//   BudgetCard renders immediately (QB COS fields absent = optional in BudgetDataType).
//   Revenue + Labor cards stay skeleton.
//
// phase=2 (slow, QB): Full QB-enriched data — actual COS, monthly/annual revenue, labor.
//   Client fires phase 1, then phase 2 after phase 1 resolves (~150ms delay).
//   Sequential avoids Supabase pool contention (both phases share the same fetchBaseData DB queries).
//   Higher phase always wins on the client (prevents stale phase 1 from overwriting warm phase 2).

import { type QuickBooksApiContext } from '@/features/dashboard/budget';
import {
  getBudgetByLocationAndMonth,
  ensureBudgetForMonth,
  mapBudgetToDataType,
  attachCurrentMonthCosToBudgets,
  attachReferenceCosToBudgets,
} from '@/features/dashboard/budget/utils/repository';
import {
  getLaborDashboardData,
  getLaborTargetByLocationAndMonth,
} from '@/features/dashboard/labor';
import {
  getRevenuePeriodData,
  getAnnualRevenuePeriodData,
  ensureRevenueTargetForMonth,
} from '@/features/dashboard/revenue';
import {
  getRevenueTargetSnapshot,
  getRevenueMonthTargetRefMonths,
} from '@/features/dashboard/revenue/utils/revenue-target-snapshot';
import {
  clampWeekOffsetForDashboard,
  getWeekOffsetContainingToday,
} from '@/features/dashboard/revenue/utils/week-range';
import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { toApiErrorResponse } from '@/lib/core/errors';
import { prisma } from '@/lib/core';
import { isValidYearMonth } from '@/lib/utils';
import { qbAbortStore } from '@/lib/quickbooks/abort-signal-store';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get('locationId');
    const yearMonth = searchParams.get('yearMonth') ?? '';
    const phase = searchParams.get('phase') ?? '2';

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 });
    }
    if (!isValidYearMonth(yearMonth)) {
      return NextResponse.json({ error: 'yearMonth must be YYYY-MM' }, { status: 400 });
    }

    const isOfficeOrAdmin = getOfficeOrAdmin(session.user.role);
    const managerLocationId = session.user.locationId ?? undefined;
    if (!isOfficeOrAdmin && managerLocationId !== locationId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const ctx = { locationId, yearMonth, userId: session.user.id, isOfficeOrAdmin };

    if (phase === '1') {
      return handlePhase1(ctx);
    }
    return await qbAbortStore.run(request.signal, () => handlePhase2(request, ctx));
  } catch (err) {
    return toApiErrorResponse(err, 'GET /api/dashboard/location-cards error:');
  }
}

function timed<T>(label: string, p: Promise<T>): Promise<T> {
  const t0 = Date.now();
  return p.then(
    (v) => { console.log(`[location-cards] ${label}=${Date.now() - t0}ms`); return v; },
    (e) => { console.log(`[location-cards] ${label}=ERR ${Date.now() - t0}ms`); throw e; },
  );
}

type Ctx = { locationId: string; yearMonth: string; userId: string; isOfficeOrAdmin: boolean };

/** Shared DB lookups: location + budget + stage-1 targets. Fast (~100-200ms on warm connection). */
async function fetchBaseData({ locationId, yearMonth, userId }: Ctx) {
  const context: QuickBooksApiContext = { baseUrl: '', cookie: null };

  const [location, budgetOrNull] = await Promise.all([
    timed('location-db', prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, startYearMonth: true },
    })),
    timed('budget-db', getBudgetByLocationAndMonth(locationId, yearMonth)),
  ]);

  if (!location) return { ok: false as const, status: 404, error: 'Location not found' };

  let budget = budgetOrNull;
  if (!budget) {
    const created = await timed('ensureBudget', ensureBudgetForMonth({
      locationId, yearMonth, userId, context,
    }));
    budget = created ? mapBudgetToDataType(created) : null;
  }

  if (!budget) {
    const noBudgetReason = location.startYearMonth != null
      ? `Budget for this location starts from ${location.startYearMonth}.`
      : 'No budget for this month.';
    return { ok: true as const, noBudget: true as const, noBudgetReason };
  }

  void ensureRevenueTargetForMonth({ locationId, yearMonth });

  const initialWeekOffset = clampWeekOffsetForDashboard(
    yearMonth,
    getWeekOffsetContainingToday(yearMonth),
  );

  const [laborTargetRow, revenueSnapshot, savedRefMonths] = await Promise.all([
    timed('laborTarget', getLaborTargetByLocationAndMonth(locationId, yearMonth)),
    timed('revenueSnapshot', getRevenueTargetSnapshot(locationId, yearMonth)),
    timed('savedRefMonths', getRevenueMonthTargetRefMonths(locationId, yearMonth)),
  ]);

  return {
    ok: true as const,
    noBudget: false as const,
    budget,
    context,
    laborTargetRow,
    revenueSnapshot,
    savedRefMonths,
    initialWeekOffset,
  };
}

/** Phase 1: DB-only response (~150ms). BudgetCard renders immediately without QB COS fields. */
async function handlePhase1(ctx: Ctx): Promise<NextResponse> {
  const base = await fetchBaseData(ctx);
  if (!base.ok) return NextResponse.json({ error: base.error }, { status: base.status });
  if (base.noBudget) {
    return NextResponse.json({
      ok: true, partial: true,
      budget: null, noBudgetReason: base.noBudgetReason,
      labor: null, monthlyRevenue: null, annualRevenue: null,
      revenueSnapshot: null, savedRefMonths: null, initialWeekOffset: 0,
    });
  }

  const { budget, revenueSnapshot, savedRefMonths, initialWeekOffset } = base;
  return NextResponse.json({
    ok: true,
    partial: true,
    budget,               // DB budget — QB COS fields (currentCosTotal etc.) absent
    labor: null,          // QB not loaded yet
    monthlyRevenue: null, // QB not loaded yet
    annualRevenue: null,  // QB not loaded yet
    revenueSnapshot: revenueSnapshot
      ? { annualGoal: revenueSnapshot.annualGoal, monthlyTarget: revenueSnapshot.monthlyTarget }
      : null,
    savedRefMonths,
    initialWeekOffset,
  });
}

/** Phase 2: Full QB-enriched response (~3-5s cold, <50ms warm cache). */
async function handlePhase2(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { locationId, yearMonth, userId } = ctx;
  const t0 = Date.now();
  const log = (msg: string) => console.log(`[location-cards p2] ${msg} +${Date.now() - t0}ms`);

  const base = await fetchBaseData(ctx);
  if (!base.ok) return NextResponse.json({ error: base.error }, { status: base.status });
  if (base.noBudget) {
    return NextResponse.json({
      ok: true, partial: false,
      budget: null, noBudgetReason: base.noBudgetReason,
      labor: null, monthlyRevenue: null, annualRevenue: null,
      revenueSnapshot: null, savedRefMonths: null, initialWeekOffset: 0,
    });
  }

  const { budget, context, laborTargetRow, revenueSnapshot, savedRefMonths, initialWeekOffset } = base;

  log('stage2-start');
  const currentCosPromise = timed('currentCos', attachCurrentMonthCosToBudgets([budget], yearMonth, context));
  const refCosPromise = timed('refCos', attachReferenceCosToBudgets([budget], yearMonth, userId, context));

  const [[budgetWithCurrentCos], monthlyRevenueBase, annualRevenue, labor, refCosResult] =
    await Promise.all([
      currentCosPromise,
      timed('monthlyRevenue', getRevenuePeriodData(locationId, yearMonth, context, { period: 'monthly', weekOffset: 0 })),
      timed('annualRevenue', getAnnualRevenuePeriodData(locationId, yearMonth, context)),
      timed('labor', getLaborDashboardData(locationId, yearMonth, context, {
        referenceIncomeTotal: budget.referenceIncomeTotal,
        laborTarget: laborTargetRow,
      })),
      refCosPromise,
    ]);
  log('stage2-done');

  const [refCosWithBudget] = refCosResult;
  const finalBudget = { ...budgetWithCurrentCos, ...refCosWithBudget };
  const monthlyRevenue = {
    ...monthlyRevenueBase,
    monthlyRevenueTarget: revenueSnapshot?.monthlyTarget,
  };

  return NextResponse.json({
    ok: true,
    partial: false,
    budget: finalBudget,
    labor,
    monthlyRevenue,
    annualRevenue,
    revenueSnapshot: revenueSnapshot
      ? { annualGoal: revenueSnapshot.annualGoal, monthlyTarget: revenueSnapshot.monthlyTarget }
      : null,
    savedRefMonths,
    initialWeekOffset,
  });
}
