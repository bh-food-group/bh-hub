// GET /api/cron/warm-dashboard — Vercel cron (Bearer CRON_SECRET)
//
// Warms 24h-cached data for all active locations before business hours.
//
//  Per location × per month (sequential months, parallel locations):
//    - getCloverDowAverages   — Clover prev-month pagination (~15s cold, 24h cache)
//    - warmPrevMonthLabor     — QB prev-month P&L (~8s cold, 24h cache)
//    - warmRefCos             — QB reference-period P&L (~4s cold, 24h cache for past months)
//    All three run in parallel; bottleneck is DOW ~15s.
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
import { getCurrentYearMonth } from '@/lib/utils';
import { format, subMonths, parseISO } from 'date-fns';

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

async function warmMonth(locationId: string, ym: string) {
  const prevYm = format(subMonths(parseISO(`${ym}-01`), 1), 'yyyy-MM');

  // Get budget to warm refCos (reference-period QB P&L, 24h cache for past months).
  // Runs in parallel with DOW + labor — no extra time since DOW (~15s) dominates.
  const budget = await getBudgetByLocationAndMonth(locationId, ym);

  const [dow, labor, refCos] = await Promise.allSettled([
    getCloverDowAverages(locationId, ym),
    warmPrevMonthLabor(locationId, prevYm),
    budget
      ? attachReferenceCosToBudgets([budget], ym, 'cron', { baseUrl: '', cookie: null })
      : Promise.resolve(null),
  ]);

  const fmt = (r: PromiseSettledResult<unknown>) =>
    r.status === 'fulfilled' ? 'ok' : `err: ${String((r as PromiseRejectedResult).reason).slice(0, 60)}`;

  return { dow: fmt(dow), labor: fmt(labor), refCos: fmt(refCos) };
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

  const results = await Promise.allSettled(
    locations.map(async ({ id, name }) => {
      const monthResults: Record<string, { dow: string; labor: string; refCos: string }> = {};

      for (const ym of months) {
        monthResults[ym] = await warmMonth(id, ym);
        console.log(`[warm-dashboard] ${name} ${ym}:`, monthResults[ym]);
      }

      return { id, name, months: monthResults };
    }),
  );

  const warmed = results.map((r) =>
    r.status === 'fulfilled' ? r.value : { error: String((r as PromiseRejectedResult).reason) },
  );

  return NextResponse.json({ ok: true, currentYearMonth, months, warmed });
}
