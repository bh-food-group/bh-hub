// GET /api/cron/labor-heatmap — Vercel cron (Bearer CRON_SECRET)
//
// Nightly Stage A refresh for the Labor module:
//   1. Ingest the trailing 8 weeks of Clover payments into labor.clover_sales_hourly
//      (idempotent upserts, bucketed to store-local Vancouver hours).
//   2. Recompute labor.sales_heatmap_cache (trimmed mean, exclusions applied).
//
// Sequential per location to bound memory (same rationale as warm-dashboard:
// each Clover pull loads a payment array; parallel locations risk OOM).
//
// Schedule: 0 13 * * * (after midnight Pacific, before warm-dashboard at 14:00).

export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { format, parseISO, subDays } from 'date-fns';
import { prisma } from '@/lib/core';
import {
  getCloverReportTimeZone,
  zonedCalendarDay,
} from '@/lib/clover/report-timezone';
import {
  ingestCloverHourly,
  ingestHolidayHistory,
} from '@/features/labor/data/clover-hourly';
import { rebuildHeatmap } from '@/features/labor/data/heatmap';
import { HEATMAP_TRAILING_WEEKS } from '@/lib/labor/constants';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz = getCloverReportTimeZone();
  const endDate = zonedCalendarDay(Date.now(), tz);
  const startDate = format(
    subDays(parseISO(endDate), HEATMAP_TRAILING_WEEKS * 7 - 1),
    'yyyy-MM-dd',
  );

  // Only locations with Clover credentials can contribute sales history.
  const locations = await prisma.location.findMany({
    where: { cloverMerchantId: { not: null }, cloverToken: { not: null } },
    select: { id: true, name: true },
  });

  console.log(
    `[labor-heatmap] ${locations.length} locations, window ${startDate}..${endDate}`,
  );

  const results: Array<Record<string, unknown>> = [];
  for (const { id, name } of locations) {
    try {
      const ingest = await ingestCloverHourly(id, startDate, endDate);
      if (ingest.cloverNotConfigured) {
        results.push({ id, name, ...ingest, cells: 0 });
        continue;
      }
      // Pull older holiday dates too, so the holiday profile has samples.
      const holidays = await ingestHolidayHistory(id);
      const rebuilt = await rebuildHeatmap(id, endDate);
      results.push({
        id,
        name,
        buckets: ingest.buckets,
        holidayDates: holidays.dates,
        cells: rebuilt.cells,
      });
    } catch (e) {
      results.push({ id, name, error: String(e).slice(0, 120) });
    }
  }

  return NextResponse.json({ window: { startDate, endDate }, results });
}
