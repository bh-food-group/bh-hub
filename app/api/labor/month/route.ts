// GET /api/labor/month?location=<id>&yearMonth=YYYY-MM
//   → monthly forecast + fixed payroll inputs, settings, and a per-weekday
//     cascade preview (how the monthly numbers distribute to each weekday).
//     Feeds the budget planner. No plan is generated/persisted.

import { NextRequest, NextResponse } from 'next/server';
import { getLaborAuthContext } from '@/lib/labor/api-auth';
import {
  computeBudgetCascade,
  dailyFixedPayrollShare,
  dailyForecastShare,
  getLaborSettings,
  getMonthlyInputs,
  isValidYearMonth,
  monthWeekdayCounts,
  weekdayDailyAverages,
} from '@/features/labor/data';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const yearMonth = searchParams.get('yearMonth') ?? '';

  const ctx = await getLaborAuthContext(searchParams.get('location'));
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!isValidYearMonth(yearMonth)) {
    return NextResponse.json(
      { error: 'yearMonth must be YYYY-MM' },
      { status: 400 },
    );
  }

  const [settings, monthly, weekdayDailyAvg] = await Promise.all([
    getLaborSettings(ctx.locationId),
    getMonthlyInputs(ctx.locationId, yearMonth),
    weekdayDailyAverages(ctx.locationId),
  ]);
  const monthCounts = monthWeekdayCounts(yearMonth);
  const dailyFixedPayroll = dailyFixedPayrollShare(
    monthly.fixedPayroll,
    yearMonth,
  );

  const perWeekday = WEEKDAYS.map((label, dow) => {
    const dailyForecast = dailyForecastShare({
      monthlyForecast: monthly.revenueForecast,
      dow,
      weekdayDailyAvg,
      monthCounts,
    });
    const cascade = computeBudgetCascade({
      revenueForecast: dailyForecast,
      fixedPayroll: dailyFixedPayroll,
      budgetPct: settings.budgetPct,
      wage: settings.wage,
    });
    return {
      dow,
      label,
      count: monthCounts[dow],
      dailyForecast,
      laborBudget: cascade.laborBudget,
      ptLaborFee: cascade.ptLaborFee,
      affordableHrs: cascade.affordableHrs,
      blocked: cascade.blocked,
    };
  });

  return NextResponse.json({
    locationId: ctx.locationId,
    yearMonth,
    revenueForecast: monthly.revenueForecast,
    fixedPayroll: monthly.fixedPayroll,
    forecastMissing: monthly.forecastMissing,
    fixedPayrollMissing: monthly.fixedPayrollMissing,
    dailyFixedPayroll,
    settings,
    perWeekday,
  });
}
