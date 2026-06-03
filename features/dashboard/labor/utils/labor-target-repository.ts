import { prisma } from '@/lib/core/prisma';

export type LaborTargetRow = {
  id: string;
  locationId: string;
  yearMonth: string;
  rate: number;
  referencePeriodMonths: number;
};

function mapLaborTarget(raw: {
  id: string;
  locationId: string;
  yearMonth: string;
  rate: unknown;
  referencePeriodMonths: number;
}): LaborTargetRow {
  return {
    id: raw.id,
    locationId: raw.locationId,
    yearMonth: raw.yearMonth,
    rate: Number(raw.rate),
    referencePeriodMonths: raw.referencePeriodMonths,
  };
}

export const LABOR_TARGET_CACHE_TAG = 'dashboard-labor-target';
const LABOR_CACHE_TTL_MS = 5 * 60 * 1000;

// Direct Postgres read — no Vercel Data Cache (unstable_cache). The L1 in-process cache
// + inflight dedup below already collapse concurrent reads, and this is a single indexed
// lookup, so a per-instance query on L1 miss is cheap. The L2 unstable_cache was removed
// because its cold-month read tail (multi-second stalls on dashboard month navigation)
// far outweighed the savings on a tiny row.
async function _getLaborTargetFromDb(
  locationId: string,
  yearMonth: string,
): Promise<LaborTargetRow | null> {
  const raw = await prisma.laborTarget.findUnique({
    where: { locationId_yearMonth: { locationId, yearMonth } },
  });
  return raw ? mapLaborTarget(raw) : null;
}

// L1: per-instance in-memory cache (sub-ms for warm hits)
// L2: Vercel Data Cache via unstable_cache (shared across instances)
const _g = globalThis as unknown as {
  _laborTargetCache?: Map<string, { value: LaborTargetRow | null; expiresAt: number }>;
  _laborTargetInflight?: Map<string, Promise<LaborTargetRow | null>>;
};
if (!_g._laborTargetCache) _g._laborTargetCache = new Map();
if (!_g._laborTargetInflight) _g._laborTargetInflight = new Map();
const _laborTargetCache = _g._laborTargetCache;
const _laborTargetInflight = _g._laborTargetInflight;

export function invalidateLaborTargetCache(locationId: string, yearMonth: string) {
  _laborTargetCache.delete(`${locationId}:${yearMonth}`);
  // Callers in route handlers should also call revalidateTag(LABOR_TARGET_CACHE_TAG).
}

export async function getLaborTargetByLocationAndMonth(
  locationId: string,
  yearMonth: string,
): Promise<LaborTargetRow | null> {
  const key = `${locationId}:${yearMonth}`;
  const now = Date.now();
  const hit = _laborTargetCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const inflight = _laborTargetInflight.get(key);
  if (inflight) return inflight;

  const promise = _getLaborTargetFromDb(locationId, yearMonth)
    .then((value) => {
      _laborTargetCache.set(key, { value, expiresAt: Date.now() + LABOR_CACHE_TTL_MS });
      return value;
    })
    .finally(() => _laborTargetInflight.delete(key));

  _laborTargetInflight.set(key, promise);
  return promise;
}

export async function upsertLaborTarget(
  locationId: string,
  yearMonth: string,
  input: { rate: number; referencePeriodMonths: number },
): Promise<LaborTargetRow> {
  const raw = await prisma.laborTarget.upsert({
    where: { locationId_yearMonth: { locationId, yearMonth } },
    create: { locationId, yearMonth, rate: input.rate, referencePeriodMonths: input.referencePeriodMonths },
    update: { rate: input.rate, referencePeriodMonths: input.referencePeriodMonths },
  });
  invalidateLaborTargetCache(locationId, yearMonth); // L1 in-memory
  return mapLaborTarget(raw);
}
