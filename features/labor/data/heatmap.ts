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
  LOW_CONFIDENCE_SAMPLE_N,
  TRIM_FRACTION,
} from '@/lib/labor/constants';
import { getLaborSettings } from './settings';
import { operatingHours } from '@/features/labor/engine';
import { format, parseISO, subDays } from 'date-fns';

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

  const [rows, exclusions] = await Promise.all([
    prisma.cloverSalesHourly.findMany({
      where: {
        locationId,
        businessDate: { gte: startDate, lte: endDate },
      },
      select: { businessDate: true, hour: true, netSales: true },
    }),
    prisma.salesSampleExclusion.findMany({
      where: { locationId, businessDate: { gte: startDate, lte: endDate } },
      select: { businessDate: true },
    }),
  ]);

  const excluded = new Set(exclusions.map((e) => e.businessDate));

  // date → (hour → netSales). A date present here means the store operated.
  const byDate = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (excluded.has(r.businessDate)) continue;
    let hm = byDate.get(r.businessDate);
    if (!hm) {
      hm = new Map();
      byDate.set(r.businessDate, hm);
    }
    hm.set(r.hour, Number.parseFloat(r.netSales.toString()));
  }

  // Group operating dates by dow.
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
    totals[r.dow] += Number.parseFloat(r.avgNetSales.toString());
  }
  return totals;
}

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
