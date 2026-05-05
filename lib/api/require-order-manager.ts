import { auth, canManageOrders, requireActiveSession } from '@/lib/auth';
import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';

/**
 * Active session + `canManageOrders` (admin, office, supply) for hub-managed
 * purchase-order / Shopify office APIs (`/api/order/*`, `/api/shopify/*`).
 */
export async function requireOrderManager(): Promise<
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      ),
    };
  }
  if (!requireActiveSession(session)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Active session required' },
        { status: 403 },
      ),
    };
  }
  if (!canManageOrders(session.user.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Order management access required' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session: session as Session };
}
