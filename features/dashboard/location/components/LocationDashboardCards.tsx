import { QB_REFRESH_EXPIRED } from '@/constants/error';
import {
  attachCurrentMonthCosToBudgets,
  attachReferenceCosToBudgets,
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
  getAnnualRevenuePeriodData,
  getRevenuePeriodData,
} from '@/features/dashboard/revenue';
import {
  getRevenueTargetSnapshot,
  getRevenueMonthTargetRefMonths,
} from '@/features/dashboard/revenue/utils/revenue-target-snapshot';
import {
  clampWeekOffsetForDashboard,
  getWeekOffsetContainingToday,
} from '@/features/dashboard/revenue/utils/week-range';
import type { BudgetDataType } from '@/features/dashboard/budget';

type Props = {
  budget: BudgetDataType;
  locationId: string;
  yearMonth: string;
  userId: string | undefined;
  isOfficeOrAdmin: boolean;
  context: QuickBooksApiContext;
};

export default async function LocationDashboardCards({
  budget: initialBudget,
  locationId,
  yearMonth,
  userId,
  isOfficeOrAdmin,
  context,
}: Props) {
  const initialWeekOffset = clampWeekOffsetForDashboard(
    yearMonth,
    getWeekOffsetContainingToday(yearMonth),
  );

  const currentCosPromise = attachCurrentMonthCosToBudgets([initialBudget], yearMonth, context);
  const refCosPromise = userId
    ? attachReferenceCosToBudgets([initialBudget], yearMonth, userId, context)
    : null;

  const monthlyRevenuePromise = getRevenuePeriodData(locationId, yearMonth, context, {
    period: 'monthly',
    weekOffset: 0,
  });
  const annualRevenuePromise = getAnnualRevenuePeriodData(locationId, yearMonth, context);

  const [laborTargetRow, revenueSnapshot, savedRefMonths] = await Promise.all([
    getLaborTargetByLocationAndMonth(locationId, yearMonth),
    getRevenueTargetSnapshot(locationId, yearMonth),
    getRevenueMonthTargetRefMonths(locationId, yearMonth),
  ]);

  const [[budgetWithCos], monthlyRevenueBase, annualRevenueBase, laborData, refCosRaw] =
    await Promise.all([
      currentCosPromise,
      monthlyRevenuePromise,
      annualRevenuePromise,
      getLaborDashboardData(locationId, yearMonth, context, {
        referenceIncomeTotal: initialBudget.referenceIncomeTotal,
        laborTarget: laborTargetRow,
      }),
      refCosPromise ?? Promise.resolve(null),
    ]);

  let budget = budgetWithCos;
  if (refCosRaw) {
    const [withRef] = refCosRaw;
    budget = { ...budget, ...withRef };
  }

  const monthlyRevenue = {
    ...monthlyRevenueBase,
    monthlyRevenueTarget: revenueSnapshot?.monthlyTarget,
  };

  return (
    <div className="grid gap-4 max-lg:grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4 lg:min-h-0">
        <div className="flex gap-4 [&>*]:flex-1">
          <AnnualRevenueCard
            data={annualRevenueBase}
            annualGoal={revenueSnapshot?.annualGoal}
            locationId={locationId}
            appliesYearMonth={yearMonth}
            showUpdateTarget={isOfficeOrAdmin}
          />
          <MonthlyRevenueCard
            data={monthlyRevenue}
            locationId={locationId}
            appliesYearMonth={yearMonth}
            showUpdateTarget={isOfficeOrAdmin}
            savedRefMonths={savedRefMonths}
          />
        </div>
        <WeeklyRevenueCard
          key={yearMonth}
          locationId={locationId}
          yearMonth={yearMonth}
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
          locationId={locationId}
          yearMonth={yearMonth}
          isOfficeOrAdmin={isOfficeOrAdmin}
        />
      </div>
    </div>
  );
}
