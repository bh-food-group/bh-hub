import { prisma } from '@/lib/core/prisma';
import { isBeforeYearMonth, isValidYearMonth } from '@/lib/utils';
import { recomputeRevenueTargetSharesForLocation } from './recompute-revenue-target-shares';

const DEFAULT_REFERENCE_PERIOD_MONTHS = 12;

/**
 * When an annual goal already exists for the calendar year, ensure this specific
 * dashboard month has its own Clover mix row (best-effort recompute).
 * Does **not** create `RevenueAnnualGoal` — that is set via the Annual goal dialog.
 */
export async function ensureRevenueTargetForMonth(args: {
  locationId: string;
  yearMonth: string;
}): Promise<void> {
  const t0 = Date.now();
  const { locationId, yearMonth } = args;
  const log = (msg: string) => console.log(`[ensure-revenue] ${msg} +${Date.now() - t0}ms`);

  if (!isValidYearMonth(yearMonth)) return;

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { startYearMonth: true },
  });
  if (
    location?.startYearMonth != null &&
    isBeforeYearMonth(yearMonth, location.startYearMonth)
  ) {
    log('exit: before-start');
    return;
  }

  const calendarYear = Number.parseInt(yearMonth.slice(0, 4), 10);
  if (!Number.isFinite(calendarYear)) return;

  const existingAnnual = await prisma.revenueAnnualGoal.findUnique({
    where: {
      locationId_calendarYear: { locationId, calendarYear },
    },
  });
  if (!existingAnnual) { log('exit: no-annual-goal'); return; }

  // Check for this exact month's row — do NOT use the fallback snapshot, otherwise
  // adjacent months (e.g. Feb/Mar) would forever skip recompute because April's row
  // satisfies the snapshot fallback.
  const existingMonth = await prisma.revenueMonthTarget.findUnique({
    where: {
      locationId_appliesYearMonth: { locationId, appliesYearMonth: yearMonth },
    },
  });
  if (existingMonth?.sharesJson?.trim()) { log('exit: already-computed'); return; }

  log('calling recompute (Clover API)');
  try {
    await recomputeRevenueTargetSharesForLocation(
      locationId,
      yearMonth,
      DEFAULT_REFERENCE_PERIOD_MONTHS,
    );
    log('recompute done');
  } catch (e) {
    log(`recompute error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
