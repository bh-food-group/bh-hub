/**
 * Month → day distribution for the budget cascade.
 *
 * Forecast and fixed payroll are entered MONTHLY. To run the per-day cascade we
 * split them onto each calendar day:
 *  - Revenue: weighted by the day's weekday sales mix (busy weekdays get more).
 *  - Fixed payroll: spread evenly across the month's days (monthly ÷ days).
 */
import { getCloverReportTimeZone, zonedWeekdaySun0ForIsoDate } from '@/lib/clover/report-timezone';
import { isBcPublicHoliday } from './holidays';

const YM_RE = /^\d{4}-\d{2}$/;

export function isValidYearMonth(ym: string): boolean {
  return YM_RE.test(ym);
}

/** 'YYYY-MM-DD' → 'YYYY-MM'. */
export function yearMonthOf(date: string): string {
  return date.slice(0, 7);
}

/** Number of calendar days in a 'YYYY-MM'. */
export function daysInMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!y || !m) return 30;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Count of each weekday (0=Sun..6=Sat) in the month, in store-local time. */
export function monthWeekdayCounts(yearMonth: string): number[] {
  const counts = new Array<number>(7).fill(0);
  if (!isValidYearMonth(yearMonth)) return counts;
  const tz = getCloverReportTimeZone();
  const days = daysInMonth(yearMonth);
  for (let d = 1; d <= days; d++) {
    const iso = `${yearMonth}-${String(d).padStart(2, '0')}`;
    counts[zonedWeekdaySun0ForIsoDate(iso, tz)]++;
  }
  return counts;
}

/**
 * Day's share of the monthly revenue forecast, weighted by weekday sales mix.
 * Falls back to an even split when there is no sales history.
 */
export function dailyForecastShare(args: {
  monthlyForecast: number;
  dow: number;
  weekdayDailyAvg: number[]; // index 0=Sun..6=Sat
  monthCounts: number[];
}): number {
  const { monthlyForecast, dow, weekdayDailyAvg, monthCounts } = args;
  const denom = monthCounts.reduce(
    (sum, count, d) => sum + count * (weekdayDailyAvg[d] ?? 0),
    0,
  );
  const totalDays = monthCounts.reduce((a, b) => a + b, 0) || 1;
  if (denom <= 0) {
    return monthlyForecast / totalDays; // no history → uniform
  }
  return (monthlyForecast * (weekdayDailyAvg[dow] ?? 0)) / denom;
}

/** Day's share of monthly fixed payroll: monthly ÷ days in month. */
export function dailyFixedPayrollShare(
  monthlyPayroll: number,
  yearMonth: string,
): number {
  return monthlyPayroll / (daysInMonth(yearMonth) || 1);
}

export type DayExpectation = {
  date: string;
  dow: number;
  holiday: boolean;
  /** Expected daily net sales used as the distribution weight for this day. */
  expected: number;
};

export type MonthExpectations = {
  perDate: Map<string, DayExpectation>;
  denom: number;
  totalDays: number;
  holidayDates: string[];
};

/**
 * Expected daily sales for every day in the month — the revenue-distribution
 * weights. A holiday uses the holiday profile's daily average (the historical
 * tendency of holidays), falling back to the normal weekday average when there is
 * no holiday history. Normal days use their weekday average.
 */
export function buildMonthExpectations(
  yearMonth: string,
  weekdayDailyAvg: number[],
  holidayDailyAvg: number,
): MonthExpectations {
  const perDate = new Map<string, DayExpectation>();
  const holidayDates: string[] = [];
  const totalDays = daysInMonth(yearMonth);
  if (!isValidYearMonth(yearMonth)) {
    return { perDate, denom: 0, totalDays, holidayDates };
  }
  const tz = getCloverReportTimeZone();
  let denom = 0;
  for (let d = 1; d <= totalDays; d++) {
    const date = `${yearMonth}-${String(d).padStart(2, '0')}`;
    const dow = zonedWeekdaySun0ForIsoDate(date, tz);
    const holiday = isBcPublicHoliday(date);
    const expected = holiday
      ? holidayDailyAvg > 0
        ? holidayDailyAvg
        : (weekdayDailyAvg[dow] ?? 0)
      : (weekdayDailyAvg[dow] ?? 0);
    perDate.set(date, { date, dow, holiday, expected });
    denom += expected;
    if (holiday) holidayDates.push(date);
  }
  return { perDate, denom, totalDays, holidayDates };
}

/** Day's share of the monthly forecast given precomputed month expectations. */
export function dailyForecastFromExpectations(
  monthlyForecast: number,
  exp: MonthExpectations,
  date: string,
): number {
  if (exp.denom <= 0) return monthlyForecast / (exp.totalDays || 1);
  const e = exp.perDate.get(date)?.expected ?? 0;
  return (monthlyForecast * e) / exp.denom;
}
