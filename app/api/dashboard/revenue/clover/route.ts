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

    if (isPastWeek) {
      const cached = await prisma.cloverWeeklyCache.findUnique({
        where: { locationId_weekStartDate: { locationId, weekStartDate: startDate } },
        select: { dataJson: true },
      });
      if (cached) {
        return NextResponse.json({
          ok: true,
          partial: false,
          yearMonth,
          weekOffset,
          startDate,
          endDate,
          data: JSON.parse(cached.dataJson) as RevenuePeriodData,
        });
      }
    }

    // phase=1: fast path — payments + prevPayments only, no order items.
    const isPhase1 = phase === '1';

    // cacheOnly: true — never hit DB from this route.
    // location-cards is the single owner of the DB query + Vercel Data Cache write.
    // On cold cache, snapshot is null → chart renders without target overlay (graceful).
    // After location-cards Phase 1 runs, Vercel Data Cache is warm → next load shows targets.
    const [snapshot, raw] = await Promise.all([
      getRevenueTargetSnapshot(locationId, yearMonth, { cacheOnly: true }),
      getCloverWeeklyRevenueData(locationId, yearMonth, weekOffset, {
        includeOrderItems: !isPhase1,
      }),
    ]);
    const data = mergeDailyRevenueTargetsIntoWeeklyData(
      raw,
      snapshot?.dailyTargetsByDate,
    );

    // Cache completed past weeks that have full data (phase=2 only).
    if (isPastWeek && !isPhase1 && !raw.cloverError && !raw.cloverNotConfigured) {
      void prisma.cloverWeeklyCache.upsert({
        where: { locationId_weekStartDate: { locationId, weekStartDate: startDate } },
        create: {
          locationId,
          weekStartDate: startDate,
          weekEndDate: endDate,
          dataJson: JSON.stringify(data),
          cachedAt: new Date(),
        },
        update: {
          weekEndDate: endDate,
          dataJson: JSON.stringify(data),
          cachedAt: new Date(),
        },
      });
    }

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
