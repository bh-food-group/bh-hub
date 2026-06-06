/**
 * Month → day distribution for the budget cascade.
 *
 * Forecast and fixed payroll are entered MONTHLY. To run the per-day cascade we
 * split them onto each calendar day:
 *  - Revenue: weighted by the day's weekday sales mix (busy weekdays get more).
 *  - Fixed payroll: spread evenly across the month's days (monthly ÷ days).
 */
import { getCloverReportTimeZone, zonedWeekdaySun0ForIsoDate } from '@/lib/clover/report-timezone';

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
