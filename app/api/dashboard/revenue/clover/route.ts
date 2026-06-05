// GET /api/dashboard/revenue/clover?locationId=&yearMonth=YYYY-MM&weekOffset=0&phase=1|2
//
// phase=1 (fast): payments + prevPayments only (~3s). Returns partial:true so the client
//   knows to follow up with phase=2 for menu stats.
// phase=2 or omitted (full): includes order items for menu performance (~11s). Caches past
//   weeks so repeat visits are instant.
// Past weeks with a DB cache entry always return full data on phase=1 (partial:false).

import { mergeDailyRevenueTargetsIntoWeeklyData } from '@/features/dashboard/revenue/utils/merge-daily-revenue-targets';
import { getCloverWeeklyRevenueData } from '@/features/dashboard/revenue/utils/get-clover-weekly-revenue';
import { getRevenueTargetSnapshot } from '@/features/dashboard/revenue/utils/revenue-target-snapshot';
import {
  getWeekOffsetsIntersectingMonth,
  isWeekStartOnOrBeforeToday,
  weekRangeForMonth,
  zonedTodayIsoForClover,
} from '@/features/dashboard/revenue/utils/week-range';
import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { toApiErrorResponse } from '@/lib/core/errors';
import { prisma } from '@/lib/core';
import { getCurrentYearMonth, isValidYearMonth } from '@/lib/utils';
import type { RevenuePeriodData } from '@/features/dashboard/revenue/components/types';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get('locationId');
    const yearMonth = searchParams.get('yearMonth') || getCurrentYearMonth();
    const weekOffsetRaw = searchParams.get('weekOffset');
    const phase = searchParams.get('phase') ?? '2';

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 },
      );
    }

    if (!isValidYearMonth(yearMonth)) {
      return NextResponse.json(
        { error: 'Invalid yearMonth; use YYYY-MM' },
        { status: 400 },
      );
    }

    const isOfficeOrAdmin = getOfficeOrAdmin(session.user.role);
    const managerLocationId = session.user.locationId ?? undefined;
    if (!isOfficeOrAdmin && managerLocationId !== locationId) {
      return NextResponse.json(
        { error: 'You can only view revenue for your own location' },
        { status: 403 },
      );
    }

    const weekOffset =
      weekOffsetRaw != null && weekOffsetRaw !== ''
        ? Number.parseInt(weekOffsetRaw, 10)
        : 0;
    if (!Number.isFinite(weekOffset)) {
      return NextResponse.json(
        { error: 'weekOffset must be an integer' },
        { status: 400 },
      );
    }

    const { min: minWeek, max: maxWeek } =
      getWeekOffsetsIntersectingMonth(yearMonth);
    if (weekOffset < minWeek || weekOffset > maxWeek) {
      return NextResponse.json(
        {
          error: `weekOffset must be between ${minWeek} and ${maxWeek} for ${yearMonth}`,
        },
        { status: 400 },
      );
    }
    if (!isWeekStartOnOrBeforeToday(yearMonth, weekOffset)) {
      return NextResponse.json(
        { error: 'Cannot load a week that has not started yet' },
        { status: 400 },
      );
    }

    const range = weekRangeForMonth(yearMonth, weekOffset);
    const { startDate, endDate } = range;

    // Past weeks are immutable — always serve from DB cache when available (full data).
    const todayIso = zonedTodayIsoForClover();
    const isPastWeek = endDate < todayIso;

    // Daily revenue targets (the remaining-to-target overlay). Fast path: read the
    // instance-local L1 cache that location-cards warms. That cache is globalThis-scoped,
    // so on Vercel the location-cards instance that warmed it may differ from the one
    // serving this request — a cold read here is common and would drop the target overlay
    // entirely (no remaining-to-target, chart shows only the actual amount). So fall back
    // to a direct DB read on miss: the snapshot is 2-3 indexed queries and this route
    // already runs the multi-second Clover fetch, so the extra query is negligible. The
    // read self-dedupes (inflight map) and warms L1 for subsequent requests.
    //
    // The target overlay is layered onto the response here, NOT frozen into the past-week
    // cache below. This keeps daily targets reflecting the latest budget and prevents a
    // cold-snapshot read from permanently stripping remaining-to-target off a cached week.
    let snapshot = await getRevenueTargetSnapshot(locationId, yearMonth, {
      cacheOnly: true,
    });
    if (!snapshot) {
      snapshot = await getRevenueTargetSnapshot(locationId, yearMonth);
    }

    if (isPastWeek) {
      const cached = await prisma.cloverWeeklyCache.findUnique({
        where: { locationId_weekStartDate: { locationId, weekStartDate: startDate } },
        select: { dataJson: true },
      });
      if (cached) {
        const cachedData = JSON.parse(cached.dataJson) as RevenuePeriodData;
        return NextResponse.json({
          ok: true,
          partial: false,
          yearMonth,
          weekOffset,
          startDate,
          endDate,
          data: mergeDailyRevenueTargetsIntoWeeklyData(
            cachedData,
            snapshot?.dailyTargetsByDate,
          ),
        });
      }
    }

    // phase=1: fast path — payments + prevPayments only, no order items.
    const isPhase1 = phase === '1';

    const raw = await getCloverWeeklyRevenueData(locationId, yearMonth, weekOffset, {
      includeOrderItems: !isPhase1,
    });

    // Cache completed past weeks that have full data (phase=2 only). Store the raw
    // revenue data WITHOUT the target overlay — targets are merged on read so they
    // always reflect the current budget and never get frozen out by a cold snapshot.
    if (isPastWeek && !isPhase1 && !raw.cloverError && !raw.cloverNotConfigured) {
      void prisma.cloverWeeklyCache.upsert({
        where: { locationId_weekStartDate: { locationId, weekStartDate: startDate } },
        create: {
          locationId,
          weekStartDate: startDate,
          weekEndDate: endDate,
          dataJson: JSON.stringify(raw),
          cachedAt: new Date(),
        },
        update: {
          weekEndDate: endDate,
          dataJson: JSON.stringify(raw),
          cachedAt: new Date(),
        },
      });
    }

    const data = mergeDailyRevenueTargetsIntoWeeklyData(
      raw,
      snapshot?.dailyTargetsByDate,
    );

    return NextResponse.json({
      ok: true,
      partial: isPhase1,
      yearMonth,
      weekOffset,
      startDate,
      endDate,
      data,
    });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/dashboard/revenue/clover error:');
  }
}
