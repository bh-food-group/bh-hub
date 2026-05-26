export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prisma } = await import('./lib/core/prisma');
    // Warm up the Prisma connection pool at server start so the first
    // user request doesn't pay the TCP+TLS+PostgreSQL auth cost (~3-4s).
    void (prisma.$queryRaw`SELECT 1` as Promise<unknown>).catch(() => {});
  }
}
