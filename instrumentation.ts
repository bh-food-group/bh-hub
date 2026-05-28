export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prisma, resetPool } = await import('./lib/core/prisma');

    // Warm TCP connections.
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        console.warn('[instrumentation] DB connection warmup timed out — resetting pool');
        resetPool();
      }
    }, 10_000);
    try {
      await Promise.all(
        Array.from({ length: 3 }, () =>
          (prisma.$queryRaw`SELECT 1` as Promise<unknown>).catch(() => {}),
        ),
      );
    } finally {
      done = true;
      clearTimeout(timer);
    }

    // Pre-warm 5-min TTL DB caches (budget, laborTarget, revenueSnapshot).
    // Sequential per location — avoids saturating PgBouncer server connections.
    // Previously ran all locations in parallel (32 concurrent queries) which collided
    // with the warm-dashboard cron (23:00 KST) and caused PgBouncer overload → OOM.
    const t = Date.now();
    try {
      const [
        { getBudgetByLocationAndMonth },
        { getLaborTargetByLocationAndMonth },
        { getRevenueTargetSnapshot, getRevenueMonthTargetRefMonths },
        { warmAllLocations },
      ] = await Promise.all([
        import('./features/dashboard/budget/utils/repository'),
        import('./features/dashboard/labor/utils/labor-target-repository'),
        import('./features/dashboard/revenue/utils/revenue-target-snapshot'),
        import('./lib/core/location-cache'),
      ]);

      const currentYearMonth = new Date().toISOString().slice(0, 7);
      const locs = await warmAllLocations();

      let warmupTimedOut = false;
      const warmupTimer = setTimeout(() => {
        if (!warmupTimedOut) {
          warmupTimedOut = true;
          console.warn('[instrumentation] cache warmup timed out — resetting pool');
          resetPool();
        }
      }, 30_000);

      try {
        for (const loc of locs) {
          if (warmupTimedOut) break;
          await Promise.all([
            getBudgetByLocationAndMonth(loc.id, currentYearMonth).catch(() => {}),
            getLaborTargetByLocationAndMonth(loc.id, currentYearMonth).catch(() => {}),
            getRevenueTargetSnapshot(loc.id, currentYearMonth).catch(() => {}),
            getRevenueMonthTargetRefMonths(loc.id, currentYearMonth).catch(() => {}),
          ]);
        }
      } finally {
        warmupTimedOut = true;
        clearTimeout(warmupTimer);
      }

      console.log(
        `[instrumentation] dashboard caches warmed for ${locs.length} locations in ${Date.now() - t}ms`,
      );
    } catch {
      // Non-fatal: first user just pays the cold-query cost instead.
    }
  }
}
