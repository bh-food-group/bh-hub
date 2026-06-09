import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/core/prisma';
import type { UserRole, UserStatus } from '@prisma/client';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
    redirect({ url, baseUrl }) {
      if (url.startsWith(baseUrl)) return url;
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      return baseUrl;
    },
    /**
     * Persist role/location on the JWT so `session` does not hit Prisma on every `auth()`
     * (e.g. each `/api/*` call). Refresh when signing in, on `update()`, or when legacy
     * tokens lack claims (first request after deploy).
     */
    async jwt({ token, user, trigger }) {
      const userId =
        (typeof user?.id === 'string' ? user.id : undefined) ??
        token.sub ??
        undefined;
      if (!userId) return token;

      // While a user is in a transitional state, re-read status/role from the DB
      // on every token resolution so the proxy (which routes purely off the JWT)
      // reflects onboarding completion and admin approval immediately — the
      // client-side session.update() is unreliable here. Terminal states
      // (active/rejected) skip this, so steady-state requests never re-hit the DB.
      const isTransitional =
        token.status === 'pending_onboarding' ||
        token.status === 'pending_approval';

      const needsProfile =
        user != null ||
        trigger === 'update' ||
        token.role === undefined ||
        token.status === undefined ||
        isTransitional;

      if (!needsProfile) return token;

      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          status: true,
          locationId: true,
          rejectReason: true,
          location: { select: { code: true } },
        },
      });
      if (dbUser) {
        token.role = dbUser.role;
        token.status = dbUser.status;
        token.locationId = dbUser.locationId;
        token.locationCode = dbUser.location?.code ?? null;
        token.rejectReason = dbUser.rejectReason ?? null;
      } else {
        // Missing user row: set sentinels so we do not refetch on every request.
        token.role = null;
        token.status = 'rejected';
        token.locationId = null;
        token.locationCode = null;
        token.rejectReason = null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? '';
        session.user.role = (token.role as UserRole | null | undefined) ?? null;
        session.user.status =
          (token.status as UserStatus | undefined) ?? 'pending_onboarding';
        session.user.locationId =
          (token.locationId as string | null | undefined) ?? null;
        session.user.locationCode =
          (token.locationCode as string | null | undefined) ?? null;
        session.user.rejectReason =
          (token.rejectReason as string | null | undefined) ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth',
  },
  session: { strategy: 'jwt' },
  trustHost: true,
  useSecureCookies: process.env.NODE_ENV === 'production',
  ...(process.env.NODE_ENV !== 'production' && {
    cookies: {
      sessionToken: {
        name: 'authjs.session-token',
        options: {
          httpOnly: true,
          sameSite: 'lax' as const,
          path: '/',
          secure: false,
        },
      },
      callbackUrl: {
        name: 'authjs.callback-url',
        options: {
          httpOnly: true,
          sameSite: 'lax' as const,
          path: '/',
          secure: false,
        },
      },
      csrfToken: {
        name: 'authjs.csrf-token',
        options: {
          httpOnly: true,
          sameSite: 'lax' as const,
          path: '/',
          secure: false,
        },
      },
    },
  }),
});

export function requireActiveSession(
  session: { user: { status: UserStatus } } | null,
) {
  if (!session?.user) return false;
  return session.user.status === 'active';
}

export function getOfficeOrAdmin(role: string | null | undefined): boolean {
  const r =
    typeof role === 'string'
      ? role.toLowerCase()
      : String(role ?? '').toLowerCase();
  return r === 'admin' || r === 'office';
}

/** Location manager (store); not authorized to edit org-wide revenue targets. */
export function getIsManager(role: string | null | undefined): boolean {
  return role === 'manager';
}

/** Can see Delivery and Cost in nav (admin, office, supply). */
export function getCanSeeDeliveryAndCost(
  role: string | null | undefined,
): boolean {
  return getOfficeOrAdmin(role) || role === 'supply';
}

/** Can see Budget and Reports in nav (admin, office, manager). Supply cannot. */
export function getCanSeeBudgetAndReports(
  role: string | null | undefined,
): boolean {
  return getOfficeOrAdmin(role) || role === 'manager';
}

/** Can see the Labor scheduler in nav (admin, office, manager). Also gated by the feature flag. */
export function getCanSeeLabor(role: string | null | undefined): boolean {
  return getOfficeOrAdmin(role) || role === 'manager';
}

export function getCanSeeOrderSection(
  role: string | null | undefined,
): boolean {
  return (
    getOfficeOrAdmin(role) ||
    role === 'supply' ||
    role === 'manager' ||
    role === 'supplier'
  );
}

export function canManageOrders(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'office' || role === 'supply';
}
