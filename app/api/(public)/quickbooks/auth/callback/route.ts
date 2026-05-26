/**
 * GET /api/quickbooks/auth/callback?code=...&realmId=...&state=...
 * State: "locationId\treturnTo" (link realm to location) or "returnTo" (path starting with /) for realm-only upsert.
 * Exchanges code for tokens, upserts Realm (create new or update tokens if conflict), optionally links Location.
 */
import { AppError } from '@/lib/core/errors';
import { decryptRefreshToken, isEncrypted } from '@/lib/core/encryption';
import { prisma } from '@/lib/core/prisma';
import { mapLegacyDashboardCostPath } from '@/lib/dashboard/default-location';
import {
  getQuickBooksOAuthClient,
  getQuickBooksCompanyName,
} from '@/lib/quickbooks';
import { NextRequest, NextResponse } from 'next/server';

const QB_CALLBACK_ERROR_CODE = 'QB_CALLBACK_ERROR';
const STATE_SEP = '\t';

function safeRedirectPath(raw: string): string | null {
  const decoded = decodeURIComponent(raw);
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return null;
  return decoded;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const realmIdParam = searchParams.get('realmId');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    const desc = searchParams.get('error_description');
    console.error(
      `QuickBooks OAuth callback error [${QB_CALLBACK_ERROR_CODE}]:`,
      error,
      desc,
    );
    return NextResponse.redirect(
      new URL(`/?qb_error=${encodeURIComponent(error)}`, request.url),
    );
  }

  if (!searchParams.get('code') || !state) {
    return NextResponse.redirect(
      new URL('/?qb_error=missing_code_or_state', request.url),
    );
  }

  const sepIdx = state.indexOf(STATE_SEP);
  let locationId: string | null = null;
  let returnTo: string | undefined;
  if (sepIdx >= 0) {
    locationId = state.slice(0, sepIdx);
    returnTo = state.slice(sepIdx + STATE_SEP.length);
  } else if (state.startsWith('/')) {
    returnTo = state;
  } else {
    locationId = state;
  }

  try {
    const oauth = getQuickBooksOAuthClient();
    const authResponse = await oauth.createToken(request.url);
    const token = authResponse.getJson();
    const qbRealmId = token.realmId ?? realmIdParam ?? '';
    const expiresAt = new Date(Date.now() + (token.expires_in || 3600) * 1000);
    const refreshExpiresAt =
      token.x_refresh_token_expires_in != null
        ? new Date(Date.now() + token.x_refresh_token_expires_in * 1000)
        : null;

    // Collect every realm row that belongs to this QB company:
    // - plain-text match (realmId === qbRealmId)
    // - encrypted match (decrypt(realmId) === qbRealmId, legacy bhpnl migration)
    const allRealms = await prisma.realm.findMany({
      select: { id: true, realmId: true, name: true, _count: { select: { locations: true } } },
    });
    const matchingRealms = allRealms.filter((r) => {
      const plain = isEncrypted(r.realmId) ? decryptRefreshToken(r.realmId) : r.realmId;
      return plain === qbRealmId;
    });

    // Canonical = the realm locations are pointing to; if multiple, pick the one with locations.
    // All others are orphans (created by prior broken reconnects) and should be deleted.
    const canonical =
      matchingRealms.find((r) => r._count.locations > 0) ?? matchingRealms[0] ?? null;
    const orphanIds = matchingRealms
      .filter((r) => r !== canonical)
      .map((r) => r.id);

    if (orphanIds.length > 0) {
      await prisma.realm.deleteMany({ where: { id: { in: orphanIds } } });
    }

    let name: string;
    if (locationId) {
      const loc = await prisma.location.findUnique({
        where: { id: locationId },
        select: { name: true },
      });
      name = loc?.name ?? `QuickBooks Company ${qbRealmId || 'Unknown'}`;
    } else if (canonical) {
      name = canonical.name;
    } else {
      const companyName = await getQuickBooksCompanyName(
        qbRealmId,
        token.access_token,
      );
      name = companyName ?? `QuickBooks Company ${qbRealmId || 'Unknown'}`;
    }

    let realm: { id: string };
    if (canonical) {
      // Update tokens and normalize realmId to plain text (orphans already deleted above).
      realm = await prisma.realm.update({
        where: { id: canonical.id },
        data: {
          realmId: qbRealmId,
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt,
          refreshExpiresAt,
        },
      });
    } else {
      realm = await prisma.realm.create({
        data: {
          realmId: qbRealmId,
          name,
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt,
          refreshExpiresAt,
        },
      });
    }

    if (locationId) {
      const location = await prisma.location.findUnique({
        where: { id: locationId },
        select: { id: true },
      });
      if (location) {
        await prisma.location.update({
          where: { id: locationId },
          data: { realmId: realm.id },
        });
      }
    }

    let redirectPath: string;
    if (returnTo) {
      const safe = safeRedirectPath(returnTo);
      redirectPath = safe
        ? await mapLegacyDashboardCostPath(safe)
        : '/';
    } else if (locationId) {
      redirectPath = `/dashboard/location/${locationId}`;
    } else {
      redirectPath = '/';
    }

    const base = new URL(request.url).origin;
    return NextResponse.redirect(new URL(redirectPath, base));
  } catch (e) {
    const err =
      e instanceof AppError
        ? e
        : new AppError(
            e instanceof Error ? e.message : 'QuickBooks callback failed',
            QB_CALLBACK_ERROR_CODE,
            { locationId },
          );
    console.error(
      `QuickBooks callback error [${err.code ?? QB_CALLBACK_ERROR_CODE}]:`,
      err.message,
      e,
    );
    return NextResponse.redirect(new URL('/?qb_error=callback', request.url));
  }
}
