export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prisma } = await import('./lib/core/prisma');
    // Warm 10 connections concurrently so the initial burst of API routes
    // (location-cards ×5 queries + clover ×3 + others) doesn't pay
    // 3-4s TCP/TLS/PostgreSQL cold-start cost per connection.
    // Server only starts accepting requests AFTER all warm connections are ready.
    await Promise.all(
      Array.from({ length: 10 }, () =>
        (prisma.$queryRaw`SELECT 1` as Promise<unknown>).catch(() => {}),
      ),
    );

    // Pre-warm dashboard caches for the current month.
    // All four slow DB queries (budget, laborTarget, revenueSnapshot, revenueRefMonths)
    // store results on globalThis so this native-ESM context shares the cache with
    // webpack-compiled route handlers. First user gets cache hits (0ms) instead of
    // 3-5s Supabase pg buffer-pool misses per table.
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
      await Promise.all(
        locs.flatMap((loc) => [
          getBudgetByLocationAndMonth(loc.id, currentYearMonth).catch(() => {}),
          getLaborTargetByLocationAndMonth(loc.id, currentYearMonth).catch(() => {}),
          getRevenueTargetSnapshot(loc.id, currentYearMonth).catch(() => {}),
          getRevenueMonthTargetRefMonths(loc.id, currentYearMonth).catch(() => {}),
        ]),
      );
      console.log(
        `[instrumentation] dashboard caches warmed for ${locs.length} locations in ${Date.now() - t}ms`,
      );
    } catch {
      // Non-fatal: first user just pays the cold-query cost instead.
    }
  }
}
