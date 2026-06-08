/**
 * Application-layer access control for /api/labor/* — the project uses Prisma
 * over a single pooled connection (no Postgres RLS), so the brief's row-level
 * rules are enforced here and every query is then scoped by the returned
 * `locationId`.
 *
 * Rules (mirroring the dashboard's revenue route):
 *  - Location users (managers tied to one location) are FORCED to their own
 *    location_id; any other requested value is rejected (403).
 *  - Office/admin may act on any location but MUST pass an explicit location_id
 *    (no implicit "all locations" read on schedule/budget screens).
 */
import { auth, getOfficeOrAdmin, requireActiveSession } from '@/lib/auth';
import type { UserRole } from '@prisma/client';

export type LaborAuthOk = {
  ok: true;
  userId: string;
  role: UserRole | null;
  isOfficeOrAdmin: boolean;
  isManager: boolean;
  /** The location the request is authorized to act on. */
  locationId: string;
};

export type LaborAuthErr = { ok: false; status: number; error: string };

export async function getLaborAuthContext(
  requestedLocationId: string | null | undefined,
): Promise<LaborAuthOk | LaborAuthErr> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }
  if (!requireActiveSession(session)) {
    return { ok: false, status: 403, error: 'Account is not active' };
  }

  const role = session.user.role;
  const isOfficeOrAdmin = getOfficeOrAdmin(role);
  const isManager = role === 'manager';
  const requested = requestedLocationId?.trim() || null;

  if (isOfficeOrAdmin) {
    if (!requested) {
      return { ok: false, status: 400, error: 'location is required' };
    }
    return {
      ok: true,
      userId: session.user.id,
      role,
      isOfficeOrAdmin: true,
      isManager: false,
      locationId: requested,
    };
  }

  // Location user: pinned to their own location.
  const ownLocation = session.user.locationId ?? null;
  if (!ownLocation) {
    return { ok: false, status: 403, error: 'No location assigned' };
  }
  if (requested && requested !== ownLocation) {
    return {
      ok: false,
      status: 403,
      error: 'You can only access your own location',
    };
  }
  return {
    ok: true,
    userId: session.user.id,
    role,
    isOfficeOrAdmin: false,
    isManager,
    locationId: ownLocation,
  };
}
