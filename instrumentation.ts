export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prisma, resetPool } = await import('./lib/core/prisma');

    // Warm TCP connections with lightweight SELECT 1.
    // Capped at 5s — if Supabase is slow at startup, don't block the instance.
    //
    // IMPORTANT: Do NOT run dashboard cache warmup here.
    // Multiple Vercel instances start simultaneously (scale-out / deployment),
    // and each would run the same 8-location × 5-query warmup in parallel,
    // saturating Supabase PgBouncer → 6-8s query waits → OOM.
    // The 5-min in-memory caches warm themselves on first use instead.
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        console.warn('[instrumentation] DB connection warmup timed out — resetting pool');
        resetPool();
      }
    }, 5_000);
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
  }
}
