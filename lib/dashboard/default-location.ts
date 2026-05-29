import { prisma } from '@/lib/core';
import { unstable_cache } from 'next/cache';

async function _getDefaultDashboardLocationId(): Promise<string | null> {
  let location = await prisma.location.findFirst({
    where: { showBudget: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!location) {
    location = await prisma.location.findFirst({
      orderBy: { createdAt: 'asc' },
    });
  }
  return location?.id ?? null;
}

/** Oldest `showBudget` location, else oldest any location (by `createdAt`). Cached for 5 min. */
export const getDefaultDashboardLocationId = unstable_cache(
  _getDefaultDashboardLocationId,
  ['default-dashboard-location'],
  { revalidate: 300 },
);

/** Rewrite legacy `/dashboard/cost` URLs (e.g. OAuth `returnTo`) to `/dashboard/location/[id]`. */
export async function mapLegacyDashboardCostPath(path: string): Promise<string> {
  const qIdx = path.indexOf('?');
  const pathname = qIdx >= 0 ? path.slice(0, qIdx) : path;
  const search = qIdx >= 0 ? path.slice(qIdx) : '';
  if (pathname === '/dashboard/cost') {
    const id = await getDefaultDashboardLocationId();
    return id ? `/dashboard/location/${id}${search}` : `/dashboard${search}`;
  }
  const m = pathname.match(/^\/dashboard\/cost\/location\/([^/]+)$/);
  if (m) {
    return `/dashboard/location/${m[1]}${search}`;
  }
  return path;
}
