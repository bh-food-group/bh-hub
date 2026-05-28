import { prisma } from './prisma';

export type CachedLocation = {
  id: string;
  code: string;
  name: string;
  startYearMonth: string | null;
  showBudget: boolean;
  cloverMerchantId: string | null;
  realmId: string;
  classId: string | null;
};

const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;
const _g = globalThis as unknown as {
  _locationById?: Map<string, { value: CachedLocation | null; expiresAt: number }>;
};
if (!_g._locationById) _g._locationById = new Map();
const _locationById = _g._locationById;

const SELECT = {
  id: true, code: true, name: true, startYearMonth: true,
  showBudget: true, cloverMerchantId: true, realmId: true, classId: true,
} as const;

export function invalidateLocationCache(id: string) {
  _locationById.delete(id);
}

export async function getLocationById(id: string): Promise<CachedLocation | null> {
  const now = Date.now();
  const hit = _locationById.get(id);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = await prisma.location.findUnique({ where: { id }, select: SELECT });
  _locationById.set(id, { value, expiresAt: now + LOCATION_CACHE_TTL_MS });
  return value;
}

export async function warmAllLocations(): Promise<CachedLocation[]> {
  const rows = await prisma.location.findMany({ select: SELECT });
  const now = Date.now();
  for (const loc of rows) {
    _locationById.set(loc.id, { value: loc, expiresAt: now + LOCATION_CACHE_TTL_MS });
  }
  return rows;
}
