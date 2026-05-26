/**
 * Compute per-day-of-week average Clover net sales for the previous calendar month.
 * Used by LaborTimeNeeded to estimate available hourly labor budget per weekday.
 */

import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { fetchCloverPaymentsInRange } from '@/lib/clover/fetch-payments';
import { cloverPaymentNetSalesCents } from '@/lib/clover/payment-net-sales';
import {
  getCloverReportTimeZone,
  zonedCalendarDay,
} from '@/lib/clover/report-timezone';
import { prisma } from '@/lib/core/prisma';
import { endOfMonth, format, getDay, parseISO, startOfMonth, subMonths } from 'date-fns';

/** Mon=0, Tue=1, …, Sun=6 */
export type CloverDowAverage = {
  dow: number;
  avgNetSales: number;
  sampleCount: number;
};

export type CloverDowAveragesData = {
  dowAverages: CloverDowAverage[];
  /** YYYY-MM of the reference month actually used. */
  refYearMonth: string;
  cloverNotConfigured?: boolean;
  cloverError?: string;
};

async function _getCloverDowAveragesUncached(
  locationId: string,
  yearMonth: string,
): Promise<CloverDowAveragesData> {
  const prevMonthStart = startOfMonth(subMonths(parseISO(`${yearMonth}-01`), 1));
  const prevMonthEnd = endOfMonth(prevMonthStart);
  const refYearMonth = format(prevMonthStart, 'yyyy-MM');

  let location: { cloverToken: string | null; cloverMerchantId: string | null } | null =
    null;
  try {
    location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { cloverToken: true, cloverMerchantId: true },
    });
  } catch {
    return { dowAverages: [], refYearMonth, cloverError: 'Database error' };
  }

  const token = location?.cloverToken?.trim() || null;
  const merchantId = location?.cloverMerchantId?.trim() || null;
  if (!token || !merchantId) {
    return { dowAverages: [], refYearMonth, cloverNotConfigured: true };
  }

  const startMs = prevMonthStart.getTime();
  // Extend end by 24h to cover the full last day in Vancouver time (UTC-7/8).
  const endMs = prevMonthEnd.getTime() + 24 * 3600 * 1000;

  const rangeStartStr = format(prevMonthStart, 'yyyy-MM-dd');
  const rangeEndStr = format(prevMonthEnd, 'yyyy-MM-dd');

  try {
    const payments = await fetchCloverPaymentsInRange(
      merchantId,
      token,
      startMs,
      endMs,
    );
    const tz = getCloverReportTimeZone();

    // Accumulate net sales per calendar date (local Vancouver time).
    const dailyNetSales = new Map<string, number>();
    for (const p of payments) {
      if (p.createdTime == null) continue;
      const dk = zonedCalendarDay(p.createdTime, tz);
      if (dk < rangeStartStr || dk > rangeEndStr) continue;
      dailyNetSales.set(
        dk,
        (dailyNetSales.get(dk) ?? 0) + cloverPaymentNetSalesCents(p) / 100,
      );
    }

    // Group by Mon-based DOW.
    // JS getDay(): 0=Sun,1=Mon,...,6=Sat → Mon-based: Mon=0,...,Sun=6
    const dowTotals = new Array<number>(7).fill(0);
    const dowCounts = new Array<number>(7).fill(0);

    for (const [date, netSales] of dailyNetSales) {
      const jsDay = getDay(parseISO(date));
      const dow = jsDay === 0 ? 6 : jsDay - 1;
      dowTotals[dow] += netSales;
      dowCounts[dow]++;
    }

    const dowAverages: CloverDowAverage[] = Array.from({ length: 7 }, (_, dow) => ({
      dow,
      avgNetSales: dowCounts[dow] > 0 ? dowTotals[dow] / dowCounts[dow] : 0,
      sampleCount: dowCounts[dow],
    }));

    return { dowAverages, refYearMonth };
  } catch (err) {
    return {
      dowAverages: [],
      refYearMonth,
      cloverError: err instanceof Error ? err.message : 'Clover API error',
    };
  }
}

// Previous month is immutable — cache for 24 hours.
const _getCloverDowAveragesPersisted = unstable_cache(
  _getCloverDowAveragesUncached,
  ['clover-dow-averages'],
  { revalidate: 86400 },
);

/**
 * Returns per-DOW average daily Clover net sales for the calendar month
 * immediately before `yearMonth`.
 * DOW: 0=Mon, 1=Tue, …, 6=Sun.
 * Cached for 24 hours (previous month data is immutable).
 */
export const getCloverDowAverages = cache(_getCloverDowAveragesPersisted);
