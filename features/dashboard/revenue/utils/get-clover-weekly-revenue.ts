import {
  fetchCloverCategories,
  fetchCloverItemIdsByCategory,
  findMenuCategories,
  findSeasonalCategory,
} from '@/lib/clover/fetch-categories';
import { fetchCloverOrderItemsInRange } from '@/lib/clover/fetch-orders';
import { fetchCloverPaymentsInRange } from '@/lib/clover/fetch-payments';
import { cloverPaymentNetSalesCents } from '@/lib/clover/payment-net-sales';
import {
  getCloverReportTimeZone,
  zonedCalendarDay,
  zonedHour,
  zonedWeekdayShort,
} from '@/lib/clover/report-timezone';
import { prisma } from '@/lib/core/prisma';
import { eachDayOfInterval, format, parseISO, subDays } from 'date-fns';
import type {
  CloverDayHourlyStat,
  CloverMenuItemStat,
  RevenuePeriodData,
} from '../components/types';
import { weekRangeForMonth } from './week-range';

const EMPTY_SEGMENT_KEY = '_clover_empty';
const EMPTY_SEGMENT_LABEL = 'Clover sales';

function weekRowsForInterval(
  weekStart: Date,
  weekEnd: Date,
  timeZone: string,
): { date: string; label: string }[] {
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
  return days.map((day) => {
    // Use noon UTC (+12h) instead of midnight UTC so that zonedCalendarDay returns
    // the correct Vancouver calendar day. UTC midnight = previous day in PDT (UTC-7).
    const ms = day.getTime() + 12 * 3600_000;
    return {
      date: zonedCalendarDay(ms, timeZone),
      label: zonedWeekdayShort(ms, timeZone),
    };
  });
}

function emptyWeekBars(
  weekStart: Date,
  weekEnd: Date,
  flags?: Pick<RevenuePeriodData, 'cloverNotConfigured' | 'cloverError'>,
): RevenuePeriodData {
  const tz = getCloverReportTimeZone();
  const rows = weekRowsForInterval(weekStart, weekEnd, tz);
  return {
    totalRevenue: 0,
    categories: [],
    dailyBars: rows.map((row) => ({
      ...row,
      segments: { [EMPTY_SEGMENT_KEY]: 0 },
      total: 0,
    })),
    dailyBarSegmentKeys: [EMPTY_SEGMENT_KEY],
    dailyBarSegmentLabels: [EMPTY_SEGMENT_LABEL],
    ...flags,
  };
}

/** Build top/bottom 10 menu item stats from raw line items. */
function buildMenuStats(
  lineItems: Awaited<ReturnType<typeof fetchCloverOrderItemsInRange>>,
  weekTotalRevenue: number,
  seasonalItemIds: Set<string>,
  menuItemIds: Set<string>,
): {
  topMenuItems: CloverMenuItemStat[];
  bottomMenuItems: CloverMenuItemStat[];
  seasonalMenuItems: CloverMenuItemStat[];
} {
  // When we have menu category data, restrict to DRINK/FOOD/KIDS/BAKERY items only.
  const eligibleItems =
    menuItemIds.size > 0
      ? lineItems.filter((li) => li.itemId !== null && menuItemIds.has(li.itemId))
      : lineItems;

  const statsMap = new Map<
    string,
    {
      itemId: string | null;
      name: string;
      quantity: number;
      revenueCents: number;
    }
  >();

  for (const li of eligibleItems) {
    const key = li.itemId ?? li.name;
    const existing = statsMap.get(key) ?? {
      itemId: li.itemId,
      name: li.name,
      quantity: 0,
      revenueCents: 0,
    };
    existing.quantity += li.quantity;
    existing.revenueCents += li.priceCents * li.quantity;
    statsMap.set(key, existing);
  }

  const allItems: CloverMenuItemStat[] = [...statsMap.values()]
    .filter((s) => s.quantity > 0)
    .map((s) => ({
      itemId: s.itemId,
      name: s.name,
      quantity: Math.round(s.quantity * 10) / 10,
      revenue: s.revenueCents / 100,
      revenuePercent:
        weekTotalRevenue > 0
          ? (s.revenueCents / 100 / weekTotalRevenue) * 100
          : 0,
    }));

  const byRevenueDesc = [...allItems].sort((a, b) => b.revenue - a.revenue);
  const byRevenueAsc = [...allItems]
    .filter((i) => i.revenue > 0)
    .sort((a, b) => a.revenue - b.revenue);

  const topMenuItems = byRevenueDesc.slice(0, 10);
  const bottomMenuItems = byRevenueAsc.slice(0, 10);

  const seasonalMenuItems =
    seasonalItemIds.size > 0
      ? byRevenueDesc.filter(
          (i) => i.itemId !== null && seasonalItemIds.has(i.itemId),
        )
      : [];

  return { topMenuItems, bottomMenuItems, seasonalMenuItems };
}

/** Build per-day-per-hour revenue data from payments. */
function buildDayHourlySales(
  payments: Awaited<ReturnType<typeof fetchCloverPaymentsInRange>>,
  weekStart: Date,
  weekEnd: Date,
  timeZone: string,
): CloverDayHourlyStat[] {
  const rows = weekRowsForInterval(weekStart, weekEnd, timeZone);
  const dayKeys = new Set(rows.map((r) => r.date));

  // { date → { hour → { revenue, count } } }
  const map = new Map<
    string,
    Map<number, { revenue: number; count: number }>
  >();
  for (const r of rows) {
    map.set(r.date, new Map());
  }

  for (const p of payments) {
    if (p.createdTime == null) continue;
    const dk = zonedCalendarDay(p.createdTime, timeZone);
    if (!dayKeys.has(dk)) continue;
    const hour = zonedHour(p.createdTime, timeZone);
    const dayMap = map.get(dk)!;
    const existing = dayMap.get(hour) ?? { revenue: 0, count: 0 };
    dayMap.set(hour, {
      revenue: existing.revenue + cloverPaymentNetSalesCents(p) / 100,
      count: existing.count + 1,
    });
  }

  const result: CloverDayHourlyStat[] = [];
  for (const [date, hourMap] of map) {
    for (const [hour, stats] of hourMap) {
      result.push({
        date,
        hour,
        revenue: stats.revenue,
        transactionCount: stats.count,
      });
    }
  }
  return result;
}

/**
 * Weekly Clover **net sales** from Payments + Orders APIs (not QuickBooks P&L).
 * Per payment: `amount − taxAmount − tipAmount` (Clover fields, cents), same as export script.
 */
/**
 * @param includeOrderItems When false (phase 1), skips the expensive /orders expand call and
 * runs payments + prevPayments in parallel instead. Returned data omits menu stats fields.
 * When true (phase 2 / cached), fetches full data including menu performance.
 */
export async function getCloverWeeklyRevenueData(
  locationId: string,
  yearMonth: string,
  weekOffset: number,
  { includeOrderItems = true }: { includeOrderItems?: boolean } = {},
): Promise<RevenuePeriodData> {
  const { weekStart, weekEnd } = weekRangeForMonth(yearMonth, weekOffset);

  let locationRecord: {
    cloverToken: string | null;
    cloverMerchantId: string | null;
  } | null = null;
  try {
    locationRecord = await prisma.location.findUnique({
      where: { id: locationId },
      select: { cloverToken: true, cloverMerchantId: true },
    });
  } catch (err) {
    return emptyWeekBars(weekStart, weekEnd, {
      cloverError: err instanceof Error ? err.message : 'Database error',
    });
  }

  const token = locationRecord?.cloverToken?.trim() || null;
  const merchantId = locationRecord?.cloverMerchantId?.trim() || null;

  if (!token || !merchantId) {
    return emptyWeekBars(weekStart, weekEnd, { cloverNotConfigured: true });
  }

  const startMs = weekStart.getTime();
  // Extend end by 24h to cover the full last day in Vancouver time (UTC-7/8 = up to
  // 8h of Sunday can fall past UTC midnight of Saturday). dayKeys filter excludes extras.
  const endMs = weekEnd.getTime() + 24 * 3600_000;

  // Previous week range for WoW comparison
  const prevRange = weekRangeForMonth(yearMonth, weekOffset - 1);
  const prevStartMs = prevRange.weekStart.getTime();
  const prevEndMs = prevRange.weekEnd.getTime() + 24 * 3600_000;

  let payments: Awaited<ReturnType<typeof fetchCloverPaymentsInRange>>;
  let prevPayments: Awaited<ReturnType<typeof fetchCloverPaymentsInRange>>;
  let orderItems: Awaited<ReturnType<typeof fetchCloverOrderItemsInRange>> = [];
  let categories: Awaited<ReturnType<typeof fetchCloverCategories>> = [];

  try {
    if (includeOrderItems) {
      // Phase 2: run all three Clover calls in parallel.
      // /payments (current) and /orders are different endpoints — no rate-limit conflict.
      // /payments (prev) is the same endpoint as current, but phase 2 starts only after
      // phase 1's single /payments call has already completed, so total concurrent
      // same-endpoint calls never exceeds 2.
      const categoriesPromise = fetchCloverCategories(merchantId, token);
      [payments, prevPayments, orderItems] = await Promise.all([
        fetchCloverPaymentsInRange(merchantId, token, startMs, endMs),
        fetchCloverPaymentsInRange(merchantId, token, prevStartMs, prevEndMs),
        fetchCloverOrderItemsInRange(merchantId, token, startMs, endMs),
      ]);
      categories = await categoriesPromise;
    } else {
      // Phase 1 fast path: only current-week payments — one single Clover call (~1-2s).
      // prevPayments and orderItems are deferred to phase 2.
      payments = await fetchCloverPaymentsInRange(merchantId, token, startMs, endMs);
      prevPayments = [];
    }
  } catch (err) {
    return emptyWeekBars(weekStart, weekEnd, {
      cloverError: err instanceof Error ? err.message : 'Clover API error',
    });
  }

  // Fetch item IDs for seasonal + menu categories (DRINK/FOOD/KIDS/BAKERY) in parallel.
  let seasonalItemIds = new Set<string>();
  let menuItemIds = new Set<string>();
  if (includeOrderItems) {
    const seasonalCategory = findSeasonalCategory(categories);
    const menuCategories = findMenuCategories(categories);

    const [seasonalIds, ...menuIdArrays] = await Promise.all([
      seasonalCategory
        ? fetchCloverItemIdsByCategory(merchantId, token, seasonalCategory.id).catch(() => [] as string[])
        : Promise.resolve([] as string[]),
      ...menuCategories.map((cat) =>
        fetchCloverItemIdsByCategory(merchantId, token, cat.id).catch(() => [] as string[]),
      ),
    ]);

    seasonalItemIds = new Set(seasonalIds);
    for (const ids of menuIdArrays) {
      for (const id of ids) menuItemIds.add(id);
    }
  }

  if (payments.length === 0) {
    return emptyWeekBars(weekStart, weekEnd);
  }

  const tz = getCloverReportTimeZone();
  const weekRows = weekRowsForInterval(weekStart, weekEnd, tz);
  const dayKeys = new Set(weekRows.map((r) => r.date));

  const dayTotalsCents = new Map<string, number>();
  for (const p of payments) {
    if (p.createdTime == null) continue;
    const dk = zonedCalendarDay(p.createdTime, tz);
    if (!dayKeys.has(dk)) continue;
    const cents = cloverPaymentNetSalesCents(p);
    dayTotalsCents.set(dk, (dayTotalsCents.get(dk) ?? 0) + cents);
  }

  const todayIso = zonedCalendarDay(Date.now(), tz);
  const inProgressWeek = weekRows.some((r) => r.date === todayIso);

  // For an in-progress week, only *complete* days (Sunday through yesterday) feed
  // the headline total and the WoW comparison. Today is excluded because its sales
  // are still being rung up — comparing a partial day against a full day last week
  // is misleading.
  const completeDayRows = inProgressWeek
    ? weekRows.filter((r) => r.date < todayIso)
    : weekRows;
  // Edge case: today *is* the week's first day (Sunday), so there are no complete
  // days yet. Fall back to today-only for the headline and drop the comparison.
  const sundayStartOnly = inProgressWeek && completeDayRows.length === 0;
  const aggregateRows = sundayStartOnly
    ? weekRows.filter((r) => r.date === todayIso)
    : completeDayRows;

  const wowCompareDayKeys = new Set(aggregateRows.map((r) => r.date));
  const prevWowCompareDayKeys = new Set(
    [...wowCompareDayKeys].map((d) =>
      format(subDays(parseISO(d), 7), 'yyyy-MM-dd'),
    ),
  );

  function sumPaymentCentsInDays(
    list: typeof payments,
    allowedDays: Set<string>,
  ): number {
    let s = 0;
    for (const p of list) {
      if (p.createdTime == null) continue;
      const dk = zonedCalendarDay(p.createdTime, tz);
      if (!allowedDays.has(dk)) continue;
      s += cloverPaymentNetSalesCents(p);
    }
    return s;
  }

  const weekTotalCents = sumPaymentCentsInDays(payments, wowCompareDayKeys);
  const weekTotalRevenue = weekTotalCents / 100;
  // No complete days yet (Sunday) → no fair basis for a WoW comparison.
  const prevWeekRevenue = sundayStartOnly
    ? undefined
    : sumPaymentCentsInDays(prevPayments, prevWowCompareDayKeys) / 100;

  const wowCompareWeekdaySpanLabel =
    inProgressWeek &&
    !sundayStartOnly &&
    aggregateRows.length > 0 &&
    aggregateRows.length < weekRows.length
      ? `${aggregateRows[0]!.label}–${aggregateRows[aggregateRows.length - 1]!.label} · Compare with same weekdays last week`
      : undefined;

  const dailyBars = weekRows.map(({ date: key, label }) => {
    const dayDollars = (dayTotalsCents.get(key) ?? 0) / 100;
    return {
      label,
      date: key,
      segments: { [EMPTY_SEGMENT_KEY]: dayDollars },
      total: dayDollars,
    };
  });

  // ── Enhanced stats (aligned with WoW window: full week or Sun–today) ───────
  const transactionCount = payments.filter((p) => {
    if (p.createdTime == null) return false;
    return wowCompareDayKeys.has(zonedCalendarDay(p.createdTime, tz));
  }).length;
  const avgTicketSize =
    transactionCount > 0 ? weekTotalRevenue / transactionCount : 0;

  const dayHourlySales = buildDayHourlySales(payments, weekStart, weekEnd, tz);

  const base: RevenuePeriodData = {
    totalRevenue: weekTotalRevenue,
    categories: [
      {
        id: EMPTY_SEGMENT_KEY,
        name: EMPTY_SEGMENT_LABEL,
        amount: weekTotalRevenue,
      },
    ],
    dailyBars,
    dailyBarSegmentKeys: [EMPTY_SEGMENT_KEY],
    dailyBarSegmentLabels: [EMPTY_SEGMENT_LABEL],
    transactionCount,
    avgTicketSize,
    // prevWeekRevenue omitted from phase 1 — WoW badge stays hidden until phase 2.
    ...(includeOrderItems ? { prevWeekRevenue, wowCompareWeekdaySpanLabel } : {}),
    dayHourlySales,
  };

  if (!includeOrderItems) return base;

  const orderItemsInWowWindow = orderItems.filter((li) =>
    wowCompareDayKeys.has(zonedCalendarDay(li.orderedAtMs, tz)),
  );
  const { topMenuItems, bottomMenuItems, seasonalMenuItems } = buildMenuStats(
    orderItemsInWowWindow,
    weekTotalRevenue,
    seasonalItemIds,
    menuItemIds,
  );

  return {
    ...base,
    topMenuItems,
    bottomMenuItems,
    seasonalMenuItems: seasonalMenuItems.length > 0 ? seasonalMenuItems : undefined,
  };
}
