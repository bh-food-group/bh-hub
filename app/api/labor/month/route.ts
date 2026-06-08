// GET /api/labor/month?location=<id>&yearMonth=YYYY-MM
//   → monthly forecast + fixed payroll inputs, settings, and a distribution
//     preview: per-weekday (non-holiday) plus a separate holidays list (holidays
//     are weighted by the holiday profile, not their weekday). No plan persisted.

import { NextRequest, NextResponse } from 'next/server';
import { getLaborAuthContext } from '@/lib/labor/api-auth';
import {
  buildMonthExpectations,
  computeBudgetCascade,
  dailyFixedPayrollShare,
  getBcPublicHolidayDisplay,
  getLaborSettings,
  getMonthlyInputs,
  holidayProfile,
  isValidYearMonth,
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

  const [settings, monthly, weekdayDailyAvg, hp] = await Promise.all([
    getLaborSettings(ctx.locationId),
    getMonthlyInputs(ctx.locationId, yearMonth),
    weekdayDailyAverages(ctx.locationId),
    holidayProfile(ctx.locationId),
  ]);
  const expectations = buildMonthExpectations(
    yearMonth,
    weekdayDailyAvg,
    hp.dailyAvg,
  );
  const dailyFixedPayroll = dailyFixedPayrollShare(
    monthly.fixedPayroll,
    yearMonth,
  );
  const denom = expectations.denom;
  const share = (expected: number) =>
    denom > 0
      ? (monthly.revenueForecast * expected) / denom
      : monthly.revenueForecast / (expectations.totalDays || 1);

  const cascadeFor = (dailyForecast: number) =>
    computeBudgetCascade({
      revenueForecast: dailyForecast,
      fixedPayroll: dailyFixedPayroll,
      budgetPct: settings.budgetPct,
      wage: settings.wage,
    });

  // Per-weekday rows count NON-holiday instances (holidays are listed separately).
  const nonHolidayCount = new Array<number>(7).fill(0);
  for (const e of expectations.perDate.values()) {
    if (!e.holiday) nonHolidayCount[e.dow]++;
  }
  const perWeekday = WEEKDAYS.map((label, dow) => {
    const dailyForecast = share(weekdayDailyAvg[dow] ?? 0);
    const c = cascadeFor(dailyForecast);
    return {
      dow,
      label,
      count: nonHolidayCount[dow],
      dailyForecast,
      laborBudget: c.laborBudget,
      ptLaborFee: c.ptLaborFee,
      affordableHrs: c.affordableHrs,
      blocked: c.blocked,
    };
  });

  const holidays = expectations.holidayDates.map((date) => {
    const e = expectations.perDate.get(date)!;
    const dailyForecast = share(e.expected);
    const c = cascadeFor(dailyForecast);
    return {
      date,
      label: getBcPublicHolidayDisplay(date),
      dow: e.dow,
      dailyForecast,
      laborBudget: c.laborBudget,
      ptLaborFee: c.ptLaborFee,
      affordableHrs: c.affordableHrs,
      blocked: c.blocked,
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
    holidays,
    holidayProfileSampleN: hp.sampleN,
  });
}
