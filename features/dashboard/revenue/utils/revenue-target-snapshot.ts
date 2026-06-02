import { prisma } from '@/lib/core/prisma';
import { unstable_cache } from 'next/cache';
import { revenueBucketKeyForIsoDate } from './revenue-target-bucket-key';
import type { RevenueTargetSharesPayload } from './revenue-target-types';
import { eachDayOfInterval, endOfMonth, format, parseISO } from 'date-fns';

const EPS = 1 / 10000;

function daysInCalendarMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function isoDatesInYear(year: number): string[] {
  const out: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const dim = daysInCalendarMonth(year, m);
    for (let d = 1; d <= dim; d++) {
      out.push(
        `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      );
    }
  }
  return out;
}

function historicShareWeight(
  buckets: Record<string, number>,
  totalCents: number,
  key: string,
): number {
  if (totalCents > 0) {
    const raw = buckets[key] ?? 0;
    if (raw > 0) return raw / totalCents;
  }
  return EPS;
}

/** Min μ (cents/day) so rare keys still get a positive slice before normalization. */
const MIN_MU_CENTS = 1;

function usesAverageDailyMix(shares: RevenueTargetSharesPayload): boolean {
  // New payloads: use bucketActiveDayCounts; old payloads: bucketDayCounts.
  const c = shares.bucketActiveDayCounts ?? shares.bucketDayCounts;
  if (!c || typeof c !== 'object') return false;
  return Object.values(c).some((n) => typeof n === 'number' && n > 0);
}

/**
 * μ = bucket cents / days-with-sales of that type in ref.
 * Prefers `bucketActiveDayCounts` (days with net sales > 0); falls back to
 * `bucketDayCounts` (all calendar days) for old payloads.
 * Returns 0 if no active days or no positive cents.
 */
function muCentsFromBucket(
  shares: RevenueTargetSharesPayload,
  key: string,
): number {
  const cents = shares.buckets[key] ?? 0;
  if (cents <= 0) return 0;
  const n =
    (shares.bucketActiveDayCounts?.[key] ?? 0) > 0
      ? shares.bucketActiveDayCounts![key]!
      : (shares.bucketDayCounts?.[key] ?? 0);
  if (n <= 0) return 0;
  return cents / n;
}

/**
 * Target-year raw weight (cents/day scale): archetype average from ref.
 *
 * For H-{DOW} keys with no positive μ (no holiday reference data), proxy with:
 *   max(same-DOW normal μ, weekend-average μ)
 *
 * Rationale:
 * - A holiday should be at least as strong as a normal day of the same DOW
 *   (same-DOW normal is the floor — e.g. Good Friday ≥ normal Friday).
 * - BC statutory holidays also attract leisure/weekend-style foot traffic,
 *   so the weekend average (Sat + Sun) is a second floor.
 * - Taking the max prevents the weekend proxy from *lowering* the target for
 *   high-traffic days like Friday (where Saturday/Sunday μ < Friday μ).
 *
 * Examples:
 *   Family Day (H-1, Mon): max(low Monday μ, higher weekend avg) → weekend avg ✓
 *   Good Friday (H-5, Fri): max(high Friday μ, lower weekend avg) → Friday μ ✓
 */
function effectiveMuCentsForKey(
  shares: RevenueTargetSharesPayload,
  key: string,
): number {
  const mu = muCentsFromBucket(shares, key);
  if (mu > 0) return mu;

  if (key.startsWith('H-')) {
    const sameDowMu = muCentsFromBucket(shares, `N-${key.slice(2)}`);
    const satMu = muCentsFromBucket(shares, 'N-6');
    const sunMu = muCentsFromBucket(shares, 'N-0');
    const weekendMus = [satMu, sunMu].filter((m) => m > 0);
    const weekendAvg =
      weekendMus.length > 0
        ? weekendMus.reduce((a, b) => a + b, 0) / weekendMus.length
        : 0;
    const best = Math.max(sameDowMu, weekendAvg);
    if (best > 0) return best;
  }

  return MIN_MU_CENTS;
}

/** Legacy: weight ∝ bucket share of total ref $ (hurts rare H-*); kept for old sharesJson. */
function buildYearDailyGoalsFromShare(
  year: number,
  annual: number,
  shares: RevenueTargetSharesPayload,
): Record<string, number> {
  const yearDays = isoDatesInYear(year);
  let denom = 0;
  const wMap = new Map<string, number>();
  for (const iso of yearDays) {
    const key = revenueBucketKeyForIsoDate(iso);
    let w = historicShareWeight(shares.buckets, shares.totalCents, key);
    if (key.startsWith('H-')) {
      // Without per-day counts the H-{DOW} bucket-share weight is severely
      // diluted: 1 holiday vs ~52 normal days in ref → holiday looks ~1/52nd.
      // Always proxy with the same-DOW normal weight so at minimum holidays
      // are on par with a normal day of the same type.
      const nKey = `N-${key.slice(2)}`;
      const nCents = shares.buckets[nKey] ?? 0;
      if (nCents > 0) {
        w = historicShareWeight(shares.buckets, shares.totalCents, nKey);
      }
    }
    wMap.set(iso, w);
    denom += w;
  }
  if (denom <= 0) return {};
  const out: Record<string, number> = {};
  for (const iso of yearDays) {
    const w = wMap.get(iso) ?? EPS;
    out[iso] = (annual * w) / denom;
  }
  return out;
}

/** μ-based: each calendar day gets ref average daily $ for its (holiday, DOW) type; sum → annual. */
function buildYearDailyGoalsFromMu(
  year: number,
  annual: number,
  shares: RevenueTargetSharesPayload,
): Record<string, number> {
  const yearDays = isoDatesInYear(year);
  let denom = 0;
  const wMap = new Map<string, number>();
  for (const iso of yearDays) {
    const key = revenueBucketKeyForIsoDate(iso);
    const w = effectiveMuCentsForKey(shares, key);
    wMap.set(iso, w);
    denom += w;
  }
  if (denom <= 0) return {};
  const out: Record<string, number> = {};
  for (const iso of yearDays) {
    const w = wMap.get(iso) ?? MIN_MU_CENTS;
    out[iso] = (annual * w) / denom;
  }
  return out;
}

function buildYearDailyGoals(
  year: number,
  annual: number,
  shares: RevenueTargetSharesPayload,
): Record<string, number> {
  if (usesAverageDailyMix(shares)) {
    return buildYearDailyGoalsFromMu(year, annual, shares);
  }
  return buildYearDailyGoalsFromShare(year, annual, shares);
}

function parseSharesJson(raw: string | null): RevenueTargetSharesPayload | null {
  if (!raw?.trim()) return null;
  try {
    const j = JSON.parse(raw) as RevenueTargetSharesPayload;
    if (!j.buckets || typeof j.totalCents !== 'number') return null;
    return j;
  } catch {
    return null;
  }
}

export type RevenueTargetSnapshot = {
  monthlyTarget: number;
  dailyTargetsByDate: Record<string, number>;
  annualGoal: number;
};

/**
 * Mix row for `appliesYearMonth`: exact row, else latest configured month ≤ that month,
 * else earliest row in the same calendar year (lexicographic YYYY-MM order).
 */
export async function resolveRevenueMonthTargetRow(
  locationId: string,
  appliesYearMonth: string,
) {
  // One query covers both exact and prev cases (desc order returns exact first).
  const lteRow = await prisma.revenueMonthTarget.findFirst({
    where: { locationId, appliesYearMonth: { lte: appliesYearMonth } },
    orderBy: { appliesYearMonth: 'desc' },
  });
  if (lteRow?.sharesJson?.trim()) return lteRow;

  // Fallback: any row in the same year (may have no sharesJson, caller handles it).
  return prisma.revenueMonthTarget.findFirst({
    where: { locationId, appliesYearMonth: { startsWith: appliesYearMonth.slice(0, 4) } },
    orderBy: { appliesYearMonth: 'asc' },
  });
}

/**
 * Daily goals: spread `annual` across each calendar day using the Clover mix row.
 * New payloads: **μ mix** — ref-period average cents/day per (holiday?, DOW) from
 * `buckets` / `bucketDayCounts`; rare H-* types no longer disappear in annual % terms.
 * Old payloads (no `bucketDayCounts`): legacy **share** mix (bucket $ / ref total $ per day slot).
 * Includes adjacent years so Sun–Sat weeks crossing Jan 1 still resolve.
 */
async function _getRevenueTargetSnapshotUncached(
  locationId: string,
  yearMonth: string,
): Promise<RevenueTargetSnapshot | null> {
  const y = Number.parseInt(yearMonth.slice(0, 4), 10);
  if (!Number.isFinite(y)) return null;

  // Annual goal + month target in parallel (was sequential: +1 round-trip saved).
  const [annualRow, monthRow] = await Promise.all([
    prisma.revenueAnnualGoal.findUnique({
      where: { locationId_calendarYear: { locationId, calendarYear: y } },
    }),
    resolveRevenueMonthTargetRow(locationId, yearMonth),
  ]);

  const annual =
    annualRow?.goalAmount != null ? Number(annualRow.goalAmount) : NaN;
  if (!Number.isFinite(annual) || annual <= 0) return null;

  const shares = parseSharesJson(monthRow?.sharesJson ?? null);
  if (!shares || shares.totalCents <= 0) return null;

  const dailyTargetsByDate: Record<string, number> = {
    ...buildYearDailyGoals(y - 1, annual, shares),
    ...buildYearDailyGoals(y, annual, shares),
    ...buildYearDailyGoals(y + 1, annual, shares),
  };

  const monthStart = parseISO(`${yearMonth}-01`);
  const monthEnd = endOfMonth(monthStart);
  const monthDates = eachDayOfInterval({ start: monthStart, end: monthEnd }).map(
    (d) => format(d, 'yyyy-MM-dd'),
  );

  let monthlyTarget = 0;
  for (const iso of monthDates) {
    monthlyTarget += dailyTargetsByDate[iso] ?? 0;
  }

  return { annualGoal: annual, monthlyTarget, dailyTargetsByDate };
}

export const REVENUE_SNAPSHOT_CACHE_TAG = 'dashboard-revenue-snapshot';
const REV_CACHE_TTL_MS = 5 * 60 * 1000;

// Shared across all Vercel instances via Vercel Data Cache.
// Without this, every instance independently queries DB for the same location/month —
// causing PgBouncer server connection exhaustion on month navigation.
// 1-hour TTL: revenueSnapshot changes only on admin action (recomputeRevenueTargetShares);
// stale-while-revalidate means users always get instant responses after first population.
const _getRevenueTargetSnapshotCached = unstable_cache(
  _getRevenueTargetSnapshotUncached,
  ['dashboard-revenue-snapshot'],
  { revalidate: 3600, tags: [REVENUE_SNAPSHOT_CACHE_TAG] },
);

const _gRev = globalThis as unknown as {
  _revenueSnapshotCache?: Map<string, { value: RevenueTargetSnapshot | null; expiresAt: number }>;
  _revenueRefMonthsCache?: Map<string, { value: number | null; expiresAt: number }>;
  // Inflight dedup: multiple concurrent requests for the same key share one DB round-trip.
  _revenueSnapshotInflight?: Map<string, Promise<RevenueTargetSnapshot | null>>;
  _revenueRefMonthsInflight?: Map<string, Promise<number | null>>;
};
if (!_gRev._revenueSnapshotCache) _gRev._revenueSnapshotCache = new Map();
if (!_gRev._revenueRefMonthsCache) _gRev._revenueRefMonthsCache = new Map();
if (!_gRev._revenueSnapshotInflight) _gRev._revenueSnapshotInflight = new Map();
if (!_gRev._revenueRefMonthsInflight) _gRev._revenueRefMonthsInflight = new Map();
const _revenueSnapshotCache = _gRev._revenueSnapshotCache;
const _revenueRefMonthsCache = _gRev._revenueRefMonthsCache;
const _revenueSnapshotInflight = _gRev._revenueSnapshotInflight;
const _revenueRefMonthsInflight = _gRev._revenueRefMonthsInflight;

export function invalidateRevenueSnapshotCache(locationId: string, yearMonth: string) {
  _revenueSnapshotCache.delete(`${locationId}:${yearMonth}`);
  _revenueRefMonthsCache.delete(`${locationId}:${yearMonth}`);
  // Route handlers should also call revalidateTag(REVENUE_SNAPSHOT_CACHE_TAG).
}

/**
 * Revenue target snapshot with 5-min in-process cache + inflight deduplication.
 * Inflight dedup: location-cards and revenue/clover both call this for the same
 * location/month simultaneously — without dedup that doubles DB queries and
 * contributes to PgBouncer server connection exhaustion.
 */
export async function getRevenueTargetSnapshot(
  locationId: string,
  yearMonth: string,
): Promise<RevenueTargetSnapshot | null> {
  const key = `${locationId}:${yearMonth}`;
  const now = Date.now();
  const hit = _revenueSnapshotCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const inflight = _revenueSnapshotInflight.get(key);
  if (inflight) return inflight;

  const promise = _getRevenueTargetSnapshotCached(locationId, yearMonth)
    .then((value) => {
      _revenueSnapshotCache.set(key, { value, expiresAt: Date.now() + REV_CACHE_TTL_MS });
      return value;
    })
    .finally(() => _revenueSnapshotInflight.delete(key));

  _revenueSnapshotInflight.set(key, promise);
  return promise;
}

/** Returns the saved referencePeriodMonths with 5-min in-process cache + inflight dedup. */
export async function getRevenueMonthTargetRefMonths(
  locationId: string,
  appliesYearMonth: string,
): Promise<number | null> {
  const key = `${locationId}:${appliesYearMonth}`;
  const now = Date.now();
  const hit = _revenueRefMonthsCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const inflight = _revenueRefMonthsInflight.get(key);
  if (inflight) return inflight;

  const promise = prisma.revenueMonthTarget
    .findUnique({
      where: { locationId_appliesYearMonth: { locationId, appliesYearMonth } },
      select: { referencePeriodMonths: true },
    })
    .then((row) => {
      const value = row?.referencePeriodMonths ?? null;
      _revenueRefMonthsCache.set(key, { value, expiresAt: Date.now() + REV_CACHE_TTL_MS });
      return value;
    })
    .finally(() => _revenueRefMonthsInflight.delete(key));

  _revenueRefMonthsInflight.set(key, promise);
  return promise;
}
