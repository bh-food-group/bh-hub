/**
 * Helpers to avoid no-op writes during Shopify sync.
 *
 * Prisma `upsert` always issues the UPDATE branch on conflict, so re-syncing an
 * unchanged row still rewrites it — a new row version + WAL on every run. With
 * ~63k line items synced ~daily (plus manual/full syncs) this was the dominant
 * source of Supabase Disk IO. We instead read the existing row, diff it against
 * the desired data, and only write when something actually changed.
 */

import { Prisma } from '@prisma/client';

/** Order-independent deep equality for JSON-ish values (objects, arrays, scalars). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, (b as unknown[])[i]));
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => jsonEqual(ao[k], bo[k]));
}

/** Type-aware equality covering the scalar/Decimal/Date/JSON shapes we store. */
export function valueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;

  if (Prisma.Decimal.isDecimal(a) || Prisma.Decimal.isDecimal(b)) {
    try {
      return new Prisma.Decimal(a as Prisma.Decimal.Value).equals(
        new Prisma.Decimal(b as Prisma.Decimal.Value),
      );
    } catch {
      return false;
    }
  }

  if (a instanceof Date || b instanceof Date) {
    return new Date(a as Date).getTime() === new Date(b as Date).getTime();
  }

  if (typeof a === 'object' || typeof b === 'object') {
    return jsonEqual(a, b);
  }

  return false;
}

/**
 * True when `data` would change `existing`. Only keys present in `data` are
 * compared; `undefined` values are skipped (Prisma omits them, so they never
 * write). Use this to decide whether to call `.update()` at all.
 */
export function valuesDiffer(
  existing: Record<string, unknown>,
  data: Record<string, unknown>,
): boolean {
  for (const key of Object.keys(data)) {
    const desired = data[key];
    if (desired === undefined) continue;
    if (!valueEqual(existing[key], desired)) return true;
  }
  return false;
}
