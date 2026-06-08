import type { SupplierDeliverySchedule } from './supplier-delivery-schedule';

/** Parse `YYYY-MM-DD` to UTC noon (stable civil calendar for weekday math). */
export function parseYmdUtcNoon(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return new Date(NaN);
  return new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0),
  );
}

/** ISO weekday 1 = Monday … 7 = Sunday (UTC calendar date of `d`). */
export function getIsoDayUtc(d: Date): number {
  const wd = d.getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function formatYmdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function addUtcDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

/** Monday 12:00 UTC of the ISO week containing `d` (UTC civil calendar). */
function startOfIsoWeekUtcNoon(d: Date): Date {
  const isoDow = getIsoDayUtc(d);
  return addUtcDays(d, -(isoDow - 1));
}

function deliveryDateFromWindow(
  ref: Date,
  deliverWeekday: number,
  deliverIn: 'same_iso_week' | 'next_iso_week',
): Date {
  const monday = startOfIsoWeekUtcNoon(ref);
  const mondayTarget =
    deliverIn === 'next_iso_week' ? addUtcDays(monday, 7) : monday;
  const delta = deliverWeekday - 1;
  return addUtcDays(mondayTarget, delta);
}

function nextDeliveryFromWeekdays(
  ref: Date,
  weekdaysSorted: readonly number[],
  maxScanDays: number,
): string | null {
  const set = new Set(weekdaysSorted);
  // "After reference" means strictly after the reference day (exclude same day).
  for (let i = 1; i <= maxScanDays; i++) {
    const cand = addUtcDays(ref, i);
    if (set.has(getIsoDayUtc(cand))) return formatYmdUtc(cand);
  }
  return null;
}

export type ComputeDefaultExpectedYmdArgs = {
  schedule: SupplierDeliverySchedule | null | undefined;
  /**
   * Vancouver `YYYY-MM-DD` — legacy linked-order placement hint; used only when
   * `creationYmd` fails to parse (fallback anchor / slice return).
   */
  referenceYmd: string;
  /**
   * Vancouver `YYYY-MM-DD` for the calendar day the PO is being created (typically "today").
   * All schedule rules anchor on this day (not the original Shopify order day).
   */
  creationYmd: string;
};

/**
 * Default PO `expectedDate` as `YYYY-MM-DD` from supplier schedule, anchored on **PO creation
 * day** (`creationYmd`). Unknown schedule → that same calendar day (not linked order day).
 */
export function computeDefaultExpectedYmd({
  schedule,
  referenceYmd,
  creationYmd,
}: ComputeDefaultExpectedYmdArgs): string {
  const ref = parseYmdUtcNoon(referenceYmd);
  const createDay = parseYmdUtcNoon(creationYmd);
  const creationAnchor = Number.isNaN(createDay.getTime()) ? ref : createDay;
  const anchor = Number.isNaN(creationAnchor.getTime()) ? ref : creationAnchor;

  if (Number.isNaN(anchor.getTime())) {
    const s = !Number.isNaN(ref.getTime()) ? referenceYmd : creationYmd;
    return s.slice(0, 10);
  }

  if (!schedule) {
    return formatYmdUtc(anchor);
  }

  if (schedule.rule.kind === 'day_after_creation') {
    return formatYmdUtc(addUtcDays(anchor, 1));
  }

  if (schedule.deliveryWeekdays.length === 0) {
    return formatYmdUtc(anchor);
  }

  const sortedDays = [...new Set(schedule.deliveryWeekdays)].sort(
    (a, b) => a - b,
  );

  if (schedule.rule.kind === 'next_delivery_day') {
    const hit = nextDeliveryFromWeekdays(anchor, sortedDays, 21);
    return hit ?? formatYmdUtc(anchor);
  }

  // `preset` schedules must be resolved to concrete windows before reaching here
  // (see `resolveScheduleWithPresets`); if one slips through, fall back to the anchor.
  if (schedule.rule.kind !== 'iso_week_windows') {
    return formatYmdUtc(anchor);
  }

  const isoDow = getIsoDayUtc(anchor);
  for (const w of schedule.rule.windows) {
    if (w.orderWeekdays.includes(isoDow)) {
      return formatYmdUtc(
        deliveryDateFromWindow(anchor, w.deliverWeekday, w.deliverIn),
      );
    }
  }

  const fallback = nextDeliveryFromWeekdays(anchor, sortedDays, 21);
  return fallback ?? formatYmdUtc(anchor);
}
