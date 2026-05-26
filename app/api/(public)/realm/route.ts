/**
 * GET /api/realm
 * Returns realm list with QB connection status per realm (connection is per realm, not per location).
 * Office/Admin: all realms. Manager: only realm(s) used by their location(s).
 */
const ACCESS_TOKEN_BUFFER_MS = 5 * 60 * 1000;

import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { decryptRefreshToken, isEncrypted } from '@/lib/core/encryption';
import { NextResponse } from 'next/server';

export type RealmWithConnection = {
  id: string;
  name: string;
  realmId: string;
  hasTokens: boolean;
  refreshExpiresAt: string | null;
  accessTokenExpired: boolean;
  refreshTokenExpired: boolean;
  locationCount: number;
  /** True when this realm has no linked locations and duplicates another realm's QB company. Admin-only. */
  isOrphan?: boolean;
  /** ID of the canonical realm this orphan should merge into. Admin-only. */
  mergeTargetId?: string;
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isOfficeOrAdmin = getOfficeOrAdmin(session.user.role);
  const isAdmin = session.user.role === 'admin';
  const managerLocationId = session.user.locationId ?? undefined;

  const realms = await prisma.realm.findMany({
    where: isOfficeOrAdmin
      ? undefined
      : managerLocationId
        ? {
            locations: {
              some: { id: managerLocationId },
            },
          }
        : { id: 'none' },
    select: {
      id: true,
      name: true,
      realmId: true,
      refreshToken: true,
      expiresAt: true,
      refreshExpiresAt: true,
      _count: { select: { locations: true } },
    },
    orderBy: { name: 'asc' },
  });

  const now = Date.now();
  const accessExpiryThreshold = now + ACCESS_TOKEN_BUFFER_MS;

  // Build a map of plain-text QB realmId → canonical realm (has locations) for orphan detection.
  // Only relevant for admin view; skip the decryption pass for non-admins.
  const plainToCanonical = new Map<string, string>();
  if (isAdmin) {
    for (const r of realms) {
      const plain = isEncrypted(r.realmId) ? decryptRefreshToken(r.realmId) : r.realmId;
      if (r._count.locations > 0 && !plainToCanonical.has(plain)) {
        plainToCanonical.set(plain, r.id);
      }
    }
  }

  const realmsWithConnection: RealmWithConnection[] = realms.map((r) => {
    const hasTokens = Boolean(r.refreshToken);
    const expiresAt = r.expiresAt;
    const refreshExpiresAt = r.refreshExpiresAt;
    const accessTokenExpired =
      hasTokens &&
      (expiresAt == null || expiresAt.getTime() <= accessExpiryThreshold);
    const refreshTokenExpired =
      hasTokens &&
      refreshExpiresAt != null &&
      new Date(refreshExpiresAt).getTime() < now;

    const locationCount = r._count.locations;

    let isOrphan: boolean | undefined;
    let mergeTargetId: string | undefined;
    if (isAdmin && locationCount === 0) {
      const plain = isEncrypted(r.realmId) ? decryptRefreshToken(r.realmId) : r.realmId;
      const targetId = plainToCanonical.get(plain);
      if (targetId && targetId !== r.id) {
        isOrphan = true;
        mergeTargetId = targetId;
      }
    }

    return {
      id: r.id,
      name: r.name,
      realmId: r.realmId,
      hasTokens,
      refreshExpiresAt: refreshExpiresAt?.toISOString() ?? null,
      accessTokenExpired,
      refreshTokenExpired,
      locationCount,
      ...(isOrphan !== undefined && { isOrphan, mergeTargetId }),
    };
  });

  return NextResponse.json({ realms: realmsWithConnection, isAdmin });
}
