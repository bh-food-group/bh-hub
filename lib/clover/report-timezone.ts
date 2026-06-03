/** Pacific — hardcoded so Clover daily/hourly buckets match BC store time (not server UTC). */
export const CLOVER_REPORT_TIMEZONE = 'America/Vancouver' as const;

export function getCloverReportTimeZone(): string {
  return CLOVER_REPORT_TIMEZONE;
}

// Intl.DateTimeFormat construction is expensive (~0.1-0.5ms each). These helpers run
// inside 24-48-iteration hour-scan loops and are called ~1095× per revenue snapshot
// (buildYearDailyGoals over 3 years) → tens of thousands of constructions = multi-second
// event-loop blocking. Cache one formatter per timeZone and reuse — .format() is cheap.
const _calDayFmt = new Map<string, Intl.DateTimeFormat>();
const _hourFmt = new Map<string, Intl.DateTimeFormat>();
const _weekdayFmt = new Map<string, Intl.DateTimeFormat>();

function calDayFmt(timeZone: string): Intl.DateTimeFormat {
  let f = _calDayFmt.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    _calDayFmt.set(timeZone, f);
  }
  return f;
}
function hourFmt(timeZone: string): Intl.DateTimeFormat {
  let f = _hourFmt.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' });
    _hourFmt.set(timeZone, f);
  }
  return f;
}
function weekdayFmt(timeZone: string): Intl.DateTimeFormat {
  let f = _weekdayFmt.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' });
    _weekdayFmt.set(timeZone, f);
  }
  return f;
}

export function zonedCalendarDay(utcMs: number, timeZone: string): string {
  return calDayFmt(timeZone).format(new Date(utcMs));
}

export function zonedHour(utcMs: number, timeZone: string): number {
  const hourPart = hourFmt(timeZone)
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === 'hour')?.value;
  const h = Number.parseInt(hourPart ?? '0', 10);
  return Number.isFinite(h) ? h : 0;
}

export function zonedWeekdayShort(utcMs: number, timeZone: string): string {
  return weekdayFmt(timeZone)
    .format(new Date(utcMs))
    .toUpperCase()
    .slice(0, 3);
}

const WEEKDAY_SUN0: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Sunday=0 weekday for a calendar `YYYY-MM-DD` interpreted in `timeZone`. */
export function zonedWeekdaySun0ForIsoDate(
  isoDate: string,
  timeZone: string,
): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return 0;
  const start = Date.UTC(y, m - 1, d, 0, 0, 0);
  for (let h = 0; h < 48; h++) {
    const ms = start + h * 3600000;
    if (zonedCalendarDay(ms, timeZone) !== isoDate) continue;
    const short = weekdayFmt(timeZone).format(new Date(ms));
    return WEEKDAY_SUN0[short] ?? 0;
  }
  const fallback = weekdayFmt(timeZone).format(
    new Date(Date.UTC(y, m - 1, d, 18, 0, 0)),
  );
  return WEEKDAY_SUN0[fallback] ?? 0;
}

/**
 * UTC instant where `timeZone` reads `isoDate` (YYYY-MM-DD) at 12:00.
 * Use when passing a calendar day into APIs that parse date-only strings as UTC midnight
 * (which shifts the day in America/Vancouver).
 */
export function zonedNoonInstantMs(isoDate: string, timeZone: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return Date.now();
  const start = Date.UTC(y, m - 1, d, 0, 0, 0);
  let dayStart: number | null = null;
  for (let h = 0; h < 48; h++) {
    const ms = start + h * 3600000;
    if (zonedCalendarDay(ms, timeZone) === isoDate) {
      dayStart = ms;
      break;
    }
  }
  if (dayStart === null) {
    return Date.UTC(y, m - 1, d, 20, 0, 0);
  }
  for (let k = 0; k < 24; k++) {
    const t = dayStart + k * 3600000;
    if (zonedCalendarDay(t, timeZone) !== isoDate) continue;
    if (zonedHour(t, timeZone) === 12) return t;
  }
  return dayStart + 12 * 3600000;
}
