// GET /api/cron/warm-dashboard — Vercel cron (Bearer CRON_SECRET)
//
// Warms expensive API-backed caches before business hours.
//
//  Per location × per month (sequential months, parallel locations):
//    - getCloverDowAverages   — Clover prev-month pagination (~15s cold, 24h cache)
//    - warmPrevMonthLabor     — QB prev-month P&L (~8s cold, 24h cache)
//    - warmRefCos             — QB reference-period P&L (~4s cold, 24h cache for past months)
//    All three run in parallel; bottleneck is DOW ~15s.
//
//  NOT warmed here: revenueSnapshot, laborTarget (DB-only, unstable_cache 1h TTL)
//    → Only 2-3 DB queries each; first user visit populates Vercel Data Cache.
//    → stale-while-revalidate: subsequent users always get instant response.
//    → Running them in cron caused 7-min hangs (24 sequential calls × 10-15s = timeout).
//
//  NOT warmed: current-month QB P&L (currentCos, monthlyRevenue, annualRevenue, labor)
//    → 5-min TTL, expires too frequently for a daily cron.
//    → Cold hit ~2.0s; acceptable given 4s target.
//
// Schedule: 0 14 * * * (6am PST / 9am EST daily)

export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { prisma } from '@/lib/core';
import { getLaborDashboardData } from '@/features/dashboard/labor';
import { getCloverDowAverages } from '@/features/dashboard/labor/utils/get-clover-dow-averages';
import {
  getBudgetByLocationAndMonth,
  attachReferenceCosToBudgets,
} from '@/features/dashboard/budget/utils/repository';
import { getRevenueTargetSnapshot } from '@/features/dashboard/revenue/utils/revenue-target-snapshot';
import { getCurrentYearMonth } from '@/lib/utils';
import { format, subMonths, parseISO } from 'date-fns';

/** Resolves with the value or null after `ms` milliseconds — prevents unstable_cache hangs. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))]);
}

const WARM_MONTHS = 6;

// Must match cache key in prev-month-summary/route.ts exactly.
const _warmPrevMonthLaborPersisted = unstable_cache(
  (locationId: string, prevYearMonth: string) =>
    getLaborDashboardData(locationId, prevYearMonth, { baseUrl: '', cookie: null }, {
      referenceIncomeTotal: undefined,
      laborTarget: null,
    }),
  ['prev-month-labor'],
  { revalidate: 86400 },
);
const warmPrevMonthLabor = cache(_warmPrevMonthLaborPersisted);

/** Per-step caps so a slow/rate-limited external API can never hang the whole cron.
 *  Kept tight: sequential 24 jobs must fit in maxDuration (300s). Normal jobs are
 *  ~8s; this cap only bounds the pathological slow-Clover case. months[] is ordered
 *  newest-first, so if the run is truncated the current month is always warmed. */
const STEP_TIMEOUT_MS = 12_000;
const SNAPSHOT_TIMEOUT_MS = 8_000;

async function warmMonth(locationId: string, ym: string) {
  const prevYm = format(subMonths(parseISO(`${ym}-01`), 1), 'yyyy-MM');

  const budget = await getBudgetByLocationAndMonth(locationId, ym).catch(() => null);

  // Step 1: heavy Clover/QB API operations. Each is individually capped at 30s so
  // a rate-limited Clover or a slow QB report can't stall the cron indefinitely.
  // (This was the real hang source — getCloverDowAverages paginates Clover with no cap.)
  const [dow, labor, refCos] = await Promise.allSettled([
    withTimeout(getCloverDowAverages(locationId, ym), STEP_TIMEOUT_MS),
    withTimeout(warmPrevMonthLabor(locationId, prevYm), STEP_TIMEOUT_MS),
    budget
      ? withTimeout(attachReferenceCosToBudgets([budget], ym, 'cron', { baseUrl: '', cookie: null }), STEP_TIMEOUT_MS)
      : Promise.resolve(null),
  ]);

  // Step 2: revenueSnapshot — runs AFTER Clover/QB release DB connections (no contention).
  const snapshot = await withTimeout(
    getRevenueTargetSnapshot(locationId, ym).catch(() => null),
    SNAPSHOT_TIMEOUT_MS,
  );

  // `null` from withTimeout means the step hit its cap (timed out) rather than failed.
  const fmt = (r: PromiseSettledResult<unknown>) =>
    r.status !== 'fulfilled'
      ? `err: ${String((r as PromiseRejectedResult).reason).slice(0, 60)}`
      : r.value === null
        ? 'timeout'
        : 'ok';

  return {
    dow: fmt(dow),
    labor: fmt(labor),
    refCos: fmt(refCos),
    snapshot: snapshot !== null ? 'ok' : 'timeout',
  };
}


export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const currentYearMonth = getCurrentYearMonth();
  const base = parseISO(`${currentYearMonth}-01`);
  const months = Array.from({ length: WARM_MONTHS }, (_, i) =>
    format(subMonths(base, i), 'yyyy-MM'),
  );

  const locations = await prisma.location.findMany({
    where: { showBudget: true },
    select: { id: true, name: true },
  });

  console.log(`[warm-dashboard] ${locations.length} locations × ${WARM_MONTHS} months`);

  // FULLY SEQUENTIAL — one location/month at a time.
  //
  // Why not parallel? getCloverDowAverages loads a full month of payments into a
  // memory array. Running 4 locations in parallel = 4 large arrays at once, and
  // because withTimeout only races (it can't cancel the underlying Clover fetch),
  // timed-out fetches keep paginating in the background and pile up → OOM.
  //
  // Sequential keeps memory to a single in-flight job; finished jobs are GC'd
  // before the next starts. Slower wall-clock, but it never OOMs and the data is
  // 24h-cached so each daily run mostly hits warm caches anyway.
  const warmed: Array<{ id: string; name: string; months: Record<string, unknown> }> = [];
  for (const { id, name } of locations) {
    const monthResults: Record<string, unknown> = {};
    for (const ym of months) {
      monthResults[ym] = await warmMonth(id, ym).catch((e) => ({ error: String(e).slice(0, 80) }));
      console.log(`[warm-dashboard] ${name} ${ym}:`, monthResults[ym]);
    }
    warmed.push({ id, name, months: monthResults });
  }

  return NextResponse.json({ ok: true, currentYearMonth, months, warmed });
}
