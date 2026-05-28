export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prisma } = await import('./lib/core/prisma');
    // Await the warmup so the server only starts accepting requests AFTER
    // the Prisma connection pool is established. Without await, the first
    // user request can still hit the 3-4s TCP+TLS+PostgreSQL cold-start cost.
    await (prisma.$queryRaw`SELECT 1` as Promise<unknown>).catch(() => {});
  }
}
