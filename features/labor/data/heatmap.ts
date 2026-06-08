/**
 * Stage A — sales heatmap (weekday × hour average Net Sales over the trailing
 * window). Uses a trimmed mean so a holiday/closure/event day can't blow out a
 * ~8-sample average, and skips manager-excluded dates. The result is cached in
 * `labor.sales_heatmap_cache` (refreshed nightly) so screens load instantly.
 *
 * dow convention: 0=Sun..6=Sat, matching zonedWeekdaySun0ForIsoDate().
 */
import { prisma } from '@/lib/core';
import {
  getCloverReportTimeZone,
  zonedCalendarDay,
  zonedWeekdaySun0ForIsoDate,
} from '@/lib/clover/report-timezone';
import {
  HEATMAP_TRAILING_WEEKS,
  HOLIDAY_DOW,
  HOLIDAY_LOOKBACK_MONTHS,
  LOW_CONFIDENCE_SAMPLE_N,
  TRIM_FRACTION,
} from '@/lib/labor/constants';
import { getLaborSettings } from './settings';
import { isBcPublicHoliday, listBcHolidaysInRange } from './holidays';
import { operatingHours } from '@/features/labor/engine';
import { format, parseISO, subDays, subMonths } from 'date-fns';

export type HeatmapCell = {
  dow: number; // 0=Sun..6=Sat
  hour: number;
  avgNetSales: number;
  sampleN: number;
  lowConfidence: boolean;
};

/**
 * Trimmed mean: drop `frac` of the samples from each tail, average the rest.
 * Falls back to the plain mean when there are too few samples to trim.
 */
export function trimmedMean(values: number[], frac = TRIM_FRACTION): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n < 3) return values.reduce((a, b) => a + b, 0) / n;
  const sorted = [...values].sort((a, b) => a - b);
  const k = Math.floor(n * frac);
  const kept = sorted.slice(k, n - k);
  const denom = kept.length || n;
  const slice = kept.length ? kept : sorted;
  return slice.reduce((a, b) => a + b, 0) / denom;
}

/**
 * Recompute and persist the heatmap for a location from the trailing
 * `HEATMAP_TRAILING_WEEKS` of `clover_sales_hourly`, excluding sampled dates.
 * `asOfDate` defaults to today (store-local).
 */
export async function rebuildHeatmap(
  locationId: string,
  asOfDate?: string,
): Promise<{ cells: number }> {
  const tz = getCloverReportTimeZone();
  const endDate = asOfDate ?? zonedCalendarDay(Date.now(), tz);
  const startDate = format(
    subDays(parseISO(endDate), HEATMAP_TRAILING_WEEKS * 7 - 1),
    'yyyy-MM-dd',
  );

  const settings = await getLaborSettings(locationId);
  const hours = operatingHours(settings);

  // Holiday profile pools holidays over a longer window (they are rare).
  const holidayStart = format(
    subMonths(parseISO(endDate), HOLIDAY_LOOKBACK_MONTHS),
    'yyyy-MM-dd',
  );
  const holidayDates = listBcHolidaysInRange(holidayStart, endDate);

  const [rows, exclusions, holidayRows] = await Promise.all([
    prisma.cloverSalesHourly.findMany({
      where: {
        locationId,
        businessDate: { gte: startDate, lte: endDate },
      },
      select: { businessDate: true, hour: true, netSales: true },
    }),
    prisma.salesSampleExclusion.findMany({
      where: { locationId },
      select: { businessDate: true },
    }),
    holidayDates.length
      ? prisma.cloverSalesHourly.findMany({
          where: { locationId, businessDate: { in: holidayDates } },
          select: { businessDate: true, hour: true, netSales: true },
        })
      : Promise.resolve([]),
  ]);

  const manuallyExcluded = new Set(exclusions.map((e) => e.businessDate));
  // Holidays are auto-excluded from the normal weekday averages so a stat
  // holiday can't skew "a typical Monday".
  const holidaySet = new Set(holidayDates);
  const normalExcluded = (date: string) =>
    manuallyExcluded.has(date) || holidaySet.has(date);

  // date → (hour → netSales). A date present here means the store operated.
  const byDate = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (normalExcluded(r.businessDate)) continue;
    let hm = byDate.get(r.businessDate);
    if (!hm) {
      hm = new Map();
      byDate.set(r.businessDate, hm);
    }
    hm.set(r.hour, Number.parseFloat(r.netSales.toString()));
  }

  // Group operating dates by dow (0=Sun..6=Sat).
  const datesByDow = new Map<number, string[]>();
  for (const date of byDate.keys()) {
    const dow = zonedWeekdaySun0ForIsoDate(date, tz);
    const arr = datesByDow.get(dow) ?? [];
    arr.push(date);
    datesByDow.set(dow, arr);
  }

  const computedAt = new Date();
  const cells: Array<{
    dow: number;
    hour: number;
    avgNetSales: number;
    sampleN: number;
  }> = [];
  for (let dow = 0; dow < 7; dow++) {
    const dates = datesByDow.get(dow) ?? [];
    for (const hour of hours) {
      const samples = dates.map((d) => byDate.get(d)?.get(hour) ?? 0);
      cells.push({
        dow,
        hour,
        avgNetSales: trimmedMean(samples),
        sampleN: dates.length,
      });
    }
  }

  // Pooled holiday profile (dow = HOLIDAY_DOW) from all holiday dates that have
  // sales data, excluding manually-excluded ones.
  const holidayByDate = new Map<string, Map<number, number>>();
  for (const r of holidayRows) {
    if (manuallyExcluded.has(r.businessDate)) continue;
    let hm = holidayByDate.get(r.businessDate);
    if (!hm) {
      hm = new Map();
      holidayByDate.set(r.businessDate, hm);
    }
    hm.set(r.hour, Number.parseFloat(r.netSales.toString()));
  }
  const holidayDatesWithData = [...holidayByDate.keys()];
  for (const hour of hours) {
    const samples = holidayDatesWithData.map(
      (d) => holidayByDate.get(d)?.get(hour) ?? 0,
    );
    cells.push({
      dow: HOLIDAY_DOW,
      hour,
      avgNetSales: trimmedMean(samples),
      sampleN: holidayDatesWithData.length,
    });
  }

  // Replace this location's cache atomically.
  await prisma.$transaction([
    prisma.salesHeatmapCache.deleteMany({ where: { locationId } }),
    prisma.salesHeatmapCache.createMany({
      data: cells.map((c) => ({
        locationId,
        dow: c.dow,
        hour: c.hour,
        avgNetSales: c.avgNetSales,
        sampleN: c.sampleN,
        computedAt,
      })),
    }),
  ]);

  return { cells: cells.length };
}

/** Read the cached heatmap for a location. */
export async function readHeatmap(locationId: string): Promise<HeatmapCell[]> {
  const rows = await prisma.salesHeatmapCache.findMany({
    where: { locationId },
    orderBy: [{ dow: 'asc' }, { hour: 'asc' }],
  });
  return rows.map((r) => ({
    dow: r.dow,
    hour: r.hour,
    avgNetSales: Number.parseFloat(r.avgNetSales.toString()),
    sampleN: r.sampleN,
    lowConfidence: r.sampleN < LOW_CONFIDENCE_SAMPLE_N,
  }));
}

/**
 * Average daily net sales per weekday (0=Sun..6=Sat) = sum of the heatmap row
 * over operating hours. Used to weight the monthly revenue forecast onto days.
 */
export async function weekdayDailyAverages(
  locationId: string,
): Promise<number[]> {
  const settings = await getLaborSettings(locationId);
  const hours = new Set(operatingHours(settings));
  const rows = await prisma.salesHeatmapCache.findMany({
    where: { locationId },
    select: { dow: true, hour: true, avgNetSales: true },
  });
  const totals = new Array<number>(7).fill(0);
  for (const r of rows) {
    if (!hours.has(r.hour)) continue;
    if (r.dow < 0 || r.dow > 6) continue; // skip the holiday profile (dow=7)
    totals[r.dow] += Number.parseFloat(r.avgNetSales.toString());
  }
  return totals;
}

export type SalesVector = {
  s: number[];
  sampleN: number[];
  /** True when the holiday profile was used instead of the weekday row. */
  usedHolidayProfile: boolean;
};

/**
 * The sales vector `s[]` for a specific weekday, aligned to the location's
 * operating hours — the engine input for a given date.
 */
export async function salesVectorForDow(
  locationId: string,
  dow: number,
): Promise<{ s: number[]; sampleN: number[] }> {
  const settings = await getLaborSettings(locationId);
  const hours = operatingHours(settings);
  const rows = await prisma.salesHeatmapCache.findMany({
    where: { locationId, dow },
    select: { hour: true, avgNetSales: true, sampleN: true },
  });
  const byHour = new Map(
    rows.map((r) => [
      r.hour,
      {
        avg: Number.parseFloat(r.avgNetSales.toString()),
        n: r.sampleN,
      },
    ]),
  );
  return {
    s: hours.map((h) => byHour.get(h)?.avg ?? 0),
    sampleN: hours.map((h) => byHour.get(h)?.n ?? 0),
  };
}

/** Pooled holiday hourly profile (dow = HOLIDAY_DOW). */
export async function holidayProfile(
  locationId: string,
): Promise<{ s: number[]; sampleN: number; dailyAvg: number }> {
  const v = await salesVectorForDow(locationId, HOLIDAY_DOW);
  return {
    s: v.s,
    sampleN: v.sampleN[0] ?? 0,
    dailyAvg: v.s.reduce((a, b) => a + b, 0),
  };
}

/**
 * Engine sales vector for a specific DATE. On a BC statutory holiday with a
 * holiday profile, returns the holiday curve; otherwise the normal weekday row.
 */
export async function salesVectorForDate(
  locationId: string,
  date: string,
): Promise<SalesVector> {
  const tz = getCloverReportTimeZone();
  if (isBcPublicHoliday(date)) {
    const hp = await holidayProfile(locationId);
    if (hp.sampleN > 0 && hp.dailyAvg > 0) {
      const settings = await getLaborSettings(locationId);
      const n = operatingHours(settings).length;
      return {
        s: hp.s,
        sampleN: new Array(n).fill(hp.sampleN),
        usedHolidayProfile: true,
      };
    }
  }
  const dow = zonedWeekdaySun0ForIsoDate(date, tz);
  const v = await salesVectorForDow(locationId, dow);
  return { ...v, usedHolidayProfile: false };
}
