/**
 * BC statutory holiday helpers for the Labor module. Reuses the dashboard's
 * `date-holidays` wrapper (single source of truth) and adds a range lister.
 */
import { addDays, format, parseISO } from 'date-fns';
import {
  getBcPublicHolidayDisplay,
  isBcPublicHoliday,
} from '@/features/dashboard/revenue/utils/revenue-target-holidays';

export { isBcPublicHoliday, getBcPublicHolidayDisplay };

/** All BC statutory holiday dates (YYYY-MM-DD) in [startIso, endIso], inclusive. */
export function listBcHolidaysInRange(
  startIso: string,
  endIso: string,
): string[] {
  const out: string[] = [];
  let d = parseISO(startIso);
  const end = parseISO(endIso);
  // Guard against an inverted range.
  let guard = 0;
  while (d <= end && guard < 1000) {
    const iso = format(d, 'yyyy-MM-dd');
    if (isBcPublicHoliday(iso)) out.push(iso);
    d = addDays(d, 1);
    guard++;
  }
  return out;
}
