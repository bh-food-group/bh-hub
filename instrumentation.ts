export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prisma, resetPool } = await import('./lib/core/prisma');

    // Phase 1: warm TCP connections to PgBouncer (pg.Pool → PgBouncer path).
    // Phase 2: warm PgBouncer → PostgreSQL server connections with real table queries.
    //
    // Why both phases?
    //   SELECT 1 warms the pg.Pool→PgBouncer TCP connection, but in PgBouncer
    //   transaction mode the PostgreSQL server connection is released immediately
    //   after each transaction. If Next.js route compilation takes 2-3s before
    //   the first real query, the server connection may expire → first table
    //   query takes 3-5s to re-establish.
    //
    //   Real table queries keep PgBouncer's server connection pool warm so
    //   Phase 1 (location-cards) completes in ~100ms not 3-5s.
    //
    // Scale-out safety:
    //   3 queries × N simultaneous Vercel instances.
    //   N is typically 1-3 on startup (not a burst), so ≤9 concurrent queries —
    //   well within Supabase's connection limits. This is safe unlike the old
    //   8-location × 5-query warmup that caused PgBouncer saturation → OOM.
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        console.warn('[instrumentation] DB connection warmup timed out — resetting pool');
        resetPool();
      }
    }, 15_000); // 15s: handles cold Supabase start (~5s) + query time buffer
    try {
      // Phase 1: TCP + basic connectivity
      await Promise.all(
        Array.from({ length: 3 }, () =>
          (prisma.$queryRaw`SELECT 1` as Promise<unknown>).catch(() => {}),
        ),
      );
      // Phase 2: real dashboard table queries to warm PgBouncer server connections.
      // Use the same query shapes as the actual user requests so the same
      // cross-schema joins and query plans are exercised (not just LIMIT 1 scans).
      await Promise.all([
        // Same join as getBudgetByLocationAndMonth (dashboard.budgets → public.locations)
        prisma.budget.findFirst({
          include: { location: { select: { id: true, code: true, name: true } } },
        }).catch(() => {}),
        prisma.laborTarget.findFirst({ select: { id: true } }).catch(() => {}),
        prisma.revenueMonthTarget.findFirst({ select: { id: true } }).catch(() => {}),
        // revenueAnnualGoal is used in getRevenueTargetSnapshot
        prisma.revenueAnnualGoal.findFirst({ select: { id: true } }).catch(() => {}),
      ]);
    } finally {
      done = true;
      clearTimeout(timer);
    }
  }
}
