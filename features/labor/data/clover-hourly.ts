/**
 * Stage A data pipeline (Clover → hourly net sales).
 *
 * Reuses the existing Clover client (`lib/clover/*`) — no second client. Pulls
 * payments in a date range, buckets each by its store-local (America/Vancouver)
 * calendar day + hour, sums Net Sales, and upserts `labor.clover_sales_hourly`.
 *
 * Net Sales is LOCKED for the whole module to the existing dashboard definition:
 * `amount - tax - tip` over SUCCESS payments only (cents). This excludes tax (per
 * the brief) and reuses the single source of truth in
 * `cloverPaymentNetSalesCents`; SUCCESS-only payments already net out refunds.
 */
import { prisma } from '@/lib/core';
import { fetchCloverPaymentsInRange } from '@/lib/clover/fetch-payments';
import { cloverPaymentNetSalesCents } from '@/lib/clover/payment-net-sales';
import {
  getCloverReportTimeZone,
  zonedCalendarDay,
  zonedHour,
} from '@/lib/clover/report-timezone';
import { format, parseISO, subMonths } from 'date-fns';
import { listBcHolidaysInRange } from './holidays';
import { HOLIDAY_LOOKBACK_MONTHS } from '@/lib/labor/constants';

export type HourlyBucket = {
  businessDate: string; // YYYY-MM-DD (store-local)
  hour: number; // 0-23 (store-local)
  netSales: number; // dollars
};

/** Result of an ingest run. */
export type IngestResult = {
  buckets: number;
  cloverNotConfigured?: boolean;
  cloverError?: string;
};

/**
 * Bucket Clover payments in [fromMs, toMs] into store-local (date, hour) net
 * sales. Pure given the payments — extracted for testability.
 */
export function bucketPaymentsByHour(
  payments: Array<{
    createdTime?: number;
    amount?: number;
    taxAmount?: number;
    tipAmount?: number;
  }>,
  rangeStart: string,
  rangeEnd: string,
): HourlyBucket[] {
  const tz = getCloverReportTimeZone();
  // key = `${date}|${hour}` → cents
  const acc = new Map<string, number>();
  for (const p of payments) {
    if (p.createdTime == null) continue;
    const date = zonedCalendarDay(p.createdTime, tz);
    if (date < rangeStart || date > rangeEnd) continue;
    const hour = zonedHour(p.createdTime, tz);
    const key = `${date}|${hour}`;
    acc.set(key, (acc.get(key) ?? 0) + cloverPaymentNetSalesCents(p));
  }
  const out: HourlyBucket[] = [];
  for (const [key, cents] of acc) {
    const [businessDate, hourStr] = key.split('|');
    out.push({
      businessDate,
      hour: Number.parseInt(hourStr, 10),
      netSales: cents / 100,
    });
  }
  return out;
}

/**
 * Fetch + persist hourly net sales for a location over [fromDate, toDate]
 * (inclusive, YYYY-MM-DD store-local). Idempotent: re-running overwrites the
 * same (location, date, hour) rows.
 */
export async function ingestCloverHourly(
  locationId: string,
  fromDate: string,
  toDate: string,
): Promise<IngestResult> {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { cloverToken: true, cloverMerchantId: true },
  });
  const token = location?.cloverToken?.trim() || null;
  const merchantId = location?.cloverMerchantId?.trim() || null;
  if (!token || !merchantId) {
    return { buckets: 0, cloverNotConfigured: true };
  }

  // Parse the date-only bounds as UTC, then widen by a day on each side so the
  // Vancouver-local edges (UTC-7/8) are fully covered before we re-filter by the
  // store-local calendar day.
  const startMs = Date.parse(`${fromDate}T00:00:00Z`) - 24 * 3600 * 1000;
  const endMs = Date.parse(`${toDate}T00:00:00Z`) + 2 * 24 * 3600 * 1000;

  try {
    const payments = await fetchCloverPaymentsInRange(
      merchantId,
      token,
      startMs,
      endMs,
    );
    const buckets = bucketPaymentsByHour(payments, fromDate, toDate);

    // Replace the window's rows: one ranged delete + one batched insert. This is
    // idempotent on re-run and avoids a per-row upsert loop, which blows the 5s
    // interactive-transaction timeout over the pooler for ~1000 buckets.
    await prisma.$transaction([
      prisma.cloverSalesHourly.deleteMany({
        where: {
          locationId,
          businessDate: { gte: fromDate, lte: toDate },
        },
      }),
      prisma.cloverSalesHourly.createMany({
        data: buckets.map((b) => ({
          locationId,
          businessDate: b.businessDate,
          hour: b.hour,
          netSales: b.netSales,
        })),
      }),
    ]);
    return { buckets: buckets.length };
  } catch (err) {
    return {
      buckets: 0,
      cloverError: err instanceof Error ? err.message : 'Clover API error',
    };
  }
}

/**
 * Ingest each BC statutory holiday date over the trailing `lookbackMonths` so the
 * holiday sales profile has enough samples. Holidays inside the standard 8-week
 * window are already covered by the regular ingest; this fills in the older ones.
 * Each holiday is a single-day fetch, so this is ~11 small calls per year.
 */
export async function ingestHolidayHistory(
  locationId: string,
  lookbackMonths: number = HOLIDAY_LOOKBACK_MONTHS,
): Promise<{ dates: number; buckets: number; cloverNotConfigured?: boolean }> {
  const tz = getCloverReportTimeZone();
  const end = zonedCalendarDay(Date.now(), tz);
  const start = format(subMonths(parseISO(end), lookbackMonths), 'yyyy-MM-dd');
  const holidays = listBcHolidaysInRange(start, end);

  let buckets = 0;
  let dates = 0;
  for (const date of holidays) {
    const r = await ingestCloverHourly(locationId, date, date);
    if (r.cloverNotConfigured) return { dates, buckets, cloverNotConfigured: true };
    if (r.cloverError) continue;
    buckets += r.buckets;
    dates += 1;
  }
  return { dates, buckets };
}
