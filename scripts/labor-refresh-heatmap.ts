/**
 * Manually run the Labor Stage-A pipeline (what the nightly cron does):
 * ingest the trailing 8 weeks of Clover payments into labor.clover_sales_hourly,
 * then rebuild labor.sales_heatmap_cache.
 *
 * Vercel cron does not fire in local dev, so use this to populate the heatmap.
 *
 *   pnpm labor:heatmap                # all Clover-ready locations
 *   pnpm labor:heatmap <locationId>   # one location
 */
import 'dotenv/config';
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

async function main() {
  const only = process.argv[2];
  const tz = getCloverReportTimeZone();
  const endDate = zonedCalendarDay(Date.now(), tz);
  const startDate = format(
    subDays(parseISO(endDate), HEATMAP_TRAILING_WEEKS * 7 - 1),
    'yyyy-MM-dd',
  );

  const locations = await prisma.location.findMany({
    where: only
      ? { id: only }
      : { cloverMerchantId: { not: null }, cloverToken: { not: null } },
    select: { id: true, name: true, code: true },
  });

  console.log(
    `[labor:heatmap] ${locations.length} location(s), window ${startDate}..${endDate}\n`,
  );

  for (const loc of locations) {
    process.stdout.write(`• ${loc.name} (${loc.code}) … `);
    try {
      const ingest = await ingestCloverHourly(loc.id, startDate, endDate);
      if (ingest.cloverNotConfigured) {
        console.log('skipped (no Clover credentials)');
        continue;
      }
      if (ingest.cloverError) {
        console.log(`Clover error: ${ingest.cloverError}`);
        continue;
      }
      const holidays = await ingestHolidayHistory(loc.id);
      const rebuilt = await rebuildHeatmap(loc.id, endDate);
      console.log(
        `ingested ${ingest.buckets} hourly buckets + ${holidays.dates} holiday dates, ${rebuilt.cells} heatmap cells`,
      );
    } catch (e) {
      console.log(`failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
