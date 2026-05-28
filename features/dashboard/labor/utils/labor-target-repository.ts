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

const LABOR_CACHE_TTL_MS = 5 * 60 * 1000;
const _g = globalThis as unknown as {
  _laborTargetCache?: Map<string, { value: LaborTargetRow | null; expiresAt: number }>;
};
if (!_g._laborTargetCache) _g._laborTargetCache = new Map();
const _laborTargetCache = _g._laborTargetCache;

export function invalidateLaborTargetCache(locationId: string, yearMonth: string) {
  _laborTargetCache.delete(`${locationId}:${yearMonth}`);
}

export async function getLaborTargetByLocationAndMonth(
  locationId: string,
  yearMonth: string,
): Promise<LaborTargetRow | null> {
  const key = `${locationId}:${yearMonth}`;
  const now = Date.now();
  const hit = _laborTargetCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const raw = await prisma.laborTarget.findUnique({
    where: { locationId_yearMonth: { locationId, yearMonth } },
  });
  const value = raw ? mapLaborTarget(raw) : null;
  _laborTargetCache.set(key, { value, expiresAt: now + LABOR_CACHE_TTL_MS });
  return value;
}

export async function upsertLaborTarget(
  locationId: string,
  yearMonth: string,
  input: { rate: number; referencePeriodMonths: number },
): Promise<LaborTargetRow> {
  const raw = await prisma.laborTarget.upsert({
    where: { locationId_yearMonth: { locationId, yearMonth } },
    create: {
      locationId,
      yearMonth,
      rate: input.rate,
      referencePeriodMonths: input.referencePeriodMonths,
    },
    update: {
      rate: input.rate,
      referencePeriodMonths: input.referencePeriodMonths,
    },
  });
  return mapLaborTarget(raw);
}
