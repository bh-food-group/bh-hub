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

    // Upsert in a transaction so a partial failure doesn't leave a torn rollup.
    if (buckets.length > 0) {
      await prisma.$transaction(
        buckets.map((b) =>
          prisma.cloverSalesHourly.upsert({
            where: {
              locationId_businessDate_hour: {
                locationId,
                businessDate: b.businessDate,
                hour: b.hour,
              },
            },
            create: {
              locationId,
              businessDate: b.businessDate,
              hour: b.hour,
              netSales: b.netSales,
            },
            update: { netSales: b.netSales },
          }),
        ),
      );
    }
    return { buckets: buckets.length };
  } catch (err) {
    return {
      buckets: 0,
      cloverError: err instanceof Error ? err.message : 'Clover API error',
    };
  }
}
