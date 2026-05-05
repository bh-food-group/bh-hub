import { auth } from '@/lib/auth';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { UserStatus } from '@prisma/client';

const UNAUTHORIZED_PATHS = ['/auth', '/onboarding', '/waiting'];

const MANAGED_API_PREFIXES = ['/api/order', '/api/shopify'] as const;

/**
 * CORS for hub-managed JSON APIs (`/api/order/*`, `/api/shopify/*`).
 * If `MANAGED_API_CORS_ORIGIN` is set, that origin is allowed with credentials.
 * Otherwise `Access-Control-Allow-Origin: *` (all origins).
 */
function managedApiCorsHeaders(): Headers {
  const h = new Headers();
  const configured = process.env.MANAGED_API_CORS_ORIGIN?.trim();
  if (configured) {
    h.set('Access-Control-Allow-Origin', configured);
    h.set('Access-Control-Allow-Credentials', 'true');
  } else {
    h.set('Access-Control-Allow-Origin', '*');
  }
  h.set(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  );
  h.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With',
  );
  h.set('Access-Control-Max-Age', '86400');
  return h;
}

function pathMatchesManagedApi(pathname: string): boolean {
  return MANAGED_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function withManagedApiCors(req: NextRequest, res: NextResponse): NextResponse {
  if (!pathMatchesManagedApi(req.nextUrl.pathname)) return res;
  const cors = managedApiCorsHeaders();
  cors.forEach((value, key) => {
    res.headers.set(key, value);
  });
  return res;
}

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  if (pathMatchesManagedApi(pathname) && req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: managedApiCorsHeaders(),
    });
  }

  // Not a user yet -> auth
  if (!session?.user) {
    if (pathname.startsWith('/auth'))
      return withManagedApiCors(req, NextResponse.next());
    return withManagedApiCors(
      req,
      NextResponse.redirect(new URL('/auth', req.url)),
    );
  }

  const status: UserStatus = session.user.status ?? 'pending_onboarding';

  // Not onboarded -> onboarding
  if (status === 'pending_onboarding') {
    if (pathname === '/onboarding' || pathname.startsWith('/api/onboarding'))
      return withManagedApiCors(req, NextResponse.next());
    return withManagedApiCors(
      req,
      NextResponse.redirect(new URL('/onboarding', req.url)),
    );
  }

  // Not approved -> waiting
  if (status === 'pending_approval') {
    if (pathname === '/waiting')
      return withManagedApiCors(req, NextResponse.next());
    return withManagedApiCors(
      req,
      NextResponse.redirect(new URL('/waiting', req.url)),
    );
  }

  if (UNAUTHORIZED_PATHS.includes(pathname)) {
    return withManagedApiCors(
      req,
      NextResponse.redirect(new URL('/', req.url)),
    );
  }

  return withManagedApiCors(req, NextResponse.next());
});

export const config = {
  matcher: [
    // Exclude static assets, next-auth, and driver app API routes (Bearer token auth, no session).
    '/((?!_next/static|_next/image|favicon.ico|api/auth|api/delivery/driver-auth|api/delivery/driver/schedule|api/delivery/driver/location|api/delivery/daily-schedule/stop|api/delivery/daily-schedule/task|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
