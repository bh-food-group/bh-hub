export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prisma } = await import('./lib/core/prisma');

    // Warm DB connections at startup so the first user request doesn't pay the
    // cold-connection cost (PgBouncer → PostgreSQL server connection setup).
    //
    // Phase 1: SELECT 1 — warms pg.Pool → PgBouncer TCP connections.
    // Phase 2: real table queries — warms PgBouncer → PostgreSQL server connections
    //          using the same cross-schema joins as actual user requests.
    //
    // IMPORTANT: this is best-effort and NON-BLOCKING for the rest of the app.
    //   - All queries are wrapped in .catch() so a cold/slow Supabase never throws.
    //   - We do NOT resetPool() on timeout. resetPool() calls pool.end(), which
    //     force-kills EVERY in-flight query on this instance — including concurrent
    //     cron jobs and user requests. A slow cold start resolves on its own if we
    //     just wait; killing the pool turns a slow start into cascading failures
    //     ("Connection terminated", "Cannot use a pool after end").
    //   - If warmup is slow, the first real request simply pays the cold cost once.
    try {
      await Promise.all(
        Array.from({ length: 3 }, () =>
          (prisma.$queryRaw`SELECT 1` as Promise<unknown>).catch(() => {}),
        ),
      );
      await Promise.all([
        prisma.budget.findFirst({
          include: { location: { select: { id: true, code: true, name: true } } },
        }).catch(() => {}),
        prisma.laborTarget.findFirst({ select: { id: true } }).catch(() => {}),
        prisma.revenueMonthTarget.findFirst({ select: { id: true } }).catch(() => {}),
        prisma.revenueAnnualGoal.findFirst({ select: { id: true } }).catch(() => {}),
      ]);
    } catch {
      // Best-effort warmup — never block or crash startup.
    }
  }
}
