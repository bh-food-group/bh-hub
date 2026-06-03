import {
  getCloverReportTimeZone,
  zonedWeekdaySun0ForIsoDate,
} from '@/lib/clover/report-timezone';
import { isBcPublicHoliday } from './revenue-target-holidays';
// Pure function of isoDate (a date's DOW + holiday status never change), but each call
// fans out to ~40 Intl.DateTimeFormat operations via the timezone/holiday helpers.
// Memoize by isoDate so buildYearDailyGoals (~1095 dates) and recompute (per-payment,
// many repeated dates) only pay the cost once per distinct date.
const _keyCache = new Map<string, string>();

export function revenueBucketKeyForIsoDate(isoDate: string): string {
  const cached = _keyCache.get(isoDate);
  if (cached !== undefined) return cached;
  const tz = getCloverReportTimeZone();
  const dow = zonedWeekdaySun0ForIsoDate(isoDate, tz);
  const holiday = isBcPublicHoliday(isoDate);
  const key = `${holiday ? 'H' : 'N'}-${dow}`;
  _keyCache.set(isoDate, key);
  return key;
}
