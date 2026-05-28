import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Use DATABASE_URL or fallback so build/static generation succeeds without .env
const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://placeholder:placeholder@localhost:5432/placeholder';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

// Singleton pg.Pool shared across PrismaClient instances.
// max:10 — enough for concurrent bursts (location-cards × 5 + clover × 3 + others).
// idleTimeoutMillis:60s — keeps warm connections alive between browser sessions in dev
// and across Fluid Compute request reuse in production.
function getPool(): Pool {
  if (!globalForPrisma.pgPool) {
    globalForPrisma.pgPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 60_000,
    });
  }
  return globalForPrisma.pgPool;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg(getPool()),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

/**
 * After adding models, `next dev` can keep a cached PrismaClient from before
 * `pnpm prisma generate`, so `prisma.officePoEmailSettings` is undefined.
 * Detect that and replace the singleton.
 */
function clientHasOfficePoEmailSettings(client: PrismaClient): boolean {
  const delegate = (client as unknown as { officePoEmailSettings?: { findUnique?: unknown } })
    .officePoEmailSettings;
  return typeof delegate?.findUnique === 'function';
}

function getPrismaClient(): PrismaClient {
  let cached = globalForPrisma.prisma;
  if (cached && !clientHasOfficePoEmailSettings(cached)) {
    console.warn(
      '[prisma] Discarding cached PrismaClient missing officePoEmailSettings (regenerate client / restart dev server).',
    );
    void cached.$disconnect().catch(() => {});
    globalForPrisma.prisma = undefined;
    cached = undefined;
  }
  if (!cached) {
    const fresh = createPrismaClient();
    if (!clientHasOfficePoEmailSettings(fresh)) {
      throw new Error(
        'Generated Prisma client is missing officePoEmailSettings. Run `pnpm prisma generate` and restart the dev server.',
      );
    }
    globalForPrisma.prisma = fresh;
    return fresh;
  }
  return cached;
}

export function getPoolStats() {
  const pool = globalForPrisma.pgPool;
  if (!pool) return { total: 0, idle: 0, waiting: 0, initialized: false };
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, initialized: true };
}

/**
 * Lazy proxy so every access runs `getPrismaClient()` and can recover from a
 * stale global singleton after schema/client updates.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop, receiver) as unknown;
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(client);
    }
    return value;
  },
}) as PrismaClient;
