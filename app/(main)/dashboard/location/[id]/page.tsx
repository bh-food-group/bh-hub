import { QB_REFRESH_EXPIRED } from '@/constants/error';
import {
  attachCurrentMonthCosToBudgets,
  attachReferenceCosToBudgets,
  ensureBudgetForMonth,
  getBudgetByLocationAndMonth,
  mapBudgetToDataType,
  QuickBooksApiContext,
} from '@/features/dashboard/budget';
import BudgetCard from '@/features/dashboard/budget/components/card/BudgetCard';
import LaborCard from '@/features/dashboard/labor/components/card/LaborCard';
import {
  getLaborDashboardData,
  getLaborTargetByLocationAndMonth,
} from '@/features/dashboard/labor';
import AnnualRevenueCard from '@/features/dashboard/revenue/components/card/AnnualRevenueCard';
import MonthlyRevenueCard from '@/features/dashboard/revenue/components/card/MonthlyRevenueCard';
import WeeklyRevenueCard from '@/features/dashboard/revenue/components/card/WeeklyRevenueCard';
import {
  ensureRevenueTargetForMonth,
  getAnnualRevenuePeriodData,
  getCloverWeeklyRevenueData,
  getRevenuePeriodData,
} from '@/features/dashboard/revenue';
import { mergeDailyRevenueTargetsIntoWeeklyData } from '@/features/dashboard/revenue/utils/merge-daily-revenue-targets';
import {
  getRevenueTargetSnapshot,
  getRevenueMonthTargetRefMonths,
} from '@/features/dashboard/revenue/utils/revenue-target-snapshot';
import {
  clampWeekOffsetForDashboard,
  getWeekOffsetContainingToday,
} from '@/features/dashboard/revenue/utils/week-range';
import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { prisma } from '@/lib/core';
import { getCurrentYearMonth, getInternalAppBaseUrl, isValidYearMonth } from '@/lib/utils';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const LocationPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ yearMonth?: string }>;
}) => {
  // ===============================
  // Session
  // ===============================
  const session = await auth();
  const isOfficeOrAdmin = getOfficeOrAdmin(session?.user?.role);

  // ===============================
  // Location
  // ===============================
  const { id } = await params;

  // Managers can only view their own location — redirect instead of 403.
  if (!isOfficeOrAdmin) {
    const managerLocationId = session?.user?.locationId;
    if (!managerLocationId) redirect('/dashboard');
    if (managerLocationId !== id) {
      const { yearMonth: sp } = await searchParams;
      const qs = sp ? `?yearMonth=${sp}` : '';
      redirect(`/dashboard/location/${managerLocationId}${qs}`);
    }
  }

  const location = id
    ? await prisma.location.findUnique({
        where: { id },
      })
    : await prisma.location.findFirst({
        orderBy: {
          createdAt: 'asc',
        },
      });

  if (!location) {
    return notFound();
  }

  // ==============
  // Year Month
  // ===============================
  const { yearMonth: searchYearMonth } = await searchParams;
  const yearMonth = searchYearMonth ?? getCurrentYearMonth();
  if (!isValidYearMonth(yearMonth)) {
    redirect(
      `/dashboard/location/${id}?yearMonth=${getCurrentYearMonth()}`,
    );
  }

  // ===============================
  // Budget
  // ===============================
  const headersList = await headers();
  const context: QuickBooksApiContext = {
    baseUrl: getInternalAppBaseUrl(headersList),
    cookie: headersList.get('cookie'),
  };

  let budget = await getBudgetByLocationAndMonth(id, yearMonth);
  if (!budget) {
    if (!session?.user?.id) redirect('/auth');

    const created = await ensureBudgetForMonth({
      locationId: id,
      yearMonth,
      userId: session.user.id,
      context,
    });

    budget = created ? mapBudgetToDataType(created) : null;
  }

  if (budget) {
    // Start both COS fetches in parallel — they cover different date ranges and are independent.
    const currentCosPromise = attachCurrentMonthCosToBudgets(
      [budget],
      yearMonth,
      context,
    );
    const refCosPromise = session?.user?.id
      ? attachReferenceCosToBudgets(
          [budget],
          yearMonth,
          session.user.id,
          context,
        )
      : null;

    const [withCos] = await currentCosPromise;
    budget = withCos;
    if (refCosPromise) {
      const [withRef] = await refCosPromise;
      budget = { ...budget, ...withRef };
    }
  }

  if (!budget) {
    const startYearMonth = location.startYearMonth;
    const startMsg =
      startYearMonth != null
        ? `Budget for this location starts from ${startYearMonth}.`
        : 'No budget for this month.';
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
        <p>{startMsg}</p>
        <p className="mt-1 text-sm">Select a different month to view budget.</p>
      </div>
    );
  }

  const initialWeekOffset = clampWeekOffsetForDashboard(
    yearMonth,
    getWeekOffsetContainingToday(yearMonth),
  );

  // Parallel: three fast DB lookups that are independent of each other.
  const [laborTargetRow, revenueSnapshot, savedRefMonths] = await Promise.all([
    getLaborTargetByLocationAndMonth(id, yearMonth),
    getRevenueTargetSnapshot(id, yearMonth),
    getRevenueMonthTargetRefMonths(id, yearMonth),
  ]);

  // Non-blocking: recompute Clover mix if no row exists for this month.
  // `void` is safe in a long-lived Node.js process (dev + traditional servers).
  // For serverless deployments, wire up a cron/webhook to call this separately.
  void ensureRevenueTargetForMonth({ locationId: id, yearMonth });

  // Parallel: four main data fetches. QB P&L calls are deduplicated by React.cache().
  const [monthlyRevenueBase, annualRevenueBase, weeklyRevenueRaw, laborData] =
    await Promise.all([
      getRevenuePeriodData(id, yearMonth, context, {
        period: 'monthly',
        weekOffset: 0,
      }),
      getAnnualRevenuePeriodData(id, yearMonth, context),
      getCloverWeeklyRevenueData(id, yearMonth, initialWeekOffset),
      getLaborDashboardData(id, yearMonth, context, {
        referenceIncomeTotal: budget.referenceIncomeTotal,
        laborTarget: laborTargetRow,
      }),
    ]);

  const monthlyRevenue = {
    ...monthlyRevenueBase,
    monthlyRevenueTarget: revenueSnapshot?.monthlyTarget,
  };
  const weeklyRevenue = mergeDailyRevenueTargetsIntoWeeklyData(
    weeklyRevenueRaw,
    revenueSnapshot?.dailyTargetsByDate,
  );

  return (
    <div className="grid gap-4 max-lg:grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4 lg:min-h-0">
        <div className="flex gap-4 [&>*]:flex-1">
          <AnnualRevenueCard
            data={annualRevenueBase}
            annualGoal={revenueSnapshot?.annualGoal}
            locationId={id}
            appliesYearMonth={yearMonth}
            showUpdateTarget={isOfficeOrAdmin}
          />
          <MonthlyRevenueCard
            data={monthlyRevenue}
            locationId={id}
            appliesYearMonth={yearMonth}
            showUpdateTarget={isOfficeOrAdmin}
            savedRefMonths={savedRefMonths}
          />
        </div>
        <WeeklyRevenueCard
          key={yearMonth}
          locationId={id}
          yearMonth={yearMonth}
          initialData={weeklyRevenue}
          initialWeekOffset={initialWeekOffset}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {budget ? (
          <BudgetCard
            budget={budget}
            isOfficeOrAdmin={isOfficeOrAdmin}
            yearMonth={yearMonth}
            needsReconnect={budget.error === QB_REFRESH_EXPIRED}
          />
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No budget for this location this month.
            <br />
            Please contact the administrator.
          </div>
        )}
        <LaborCard
          data={laborData}
          locationId={id}
          yearMonth={yearMonth}
          isOfficeOrAdmin={isOfficeOrAdmin}
        />
      </div>
    </div>
  );
};

export default LocationPage;
