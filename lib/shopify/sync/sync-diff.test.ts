import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { jsonEqual, valueEqual, valuesDiffer } from './sync-diff';

const dec = (v: string) => new Prisma.Decimal(v);

describe('valueEqual', () => {
  it('treats null and undefined as equal to themselves', () => {
    expect(valueEqual(null, null)).toBe(true);
    expect(valueEqual(undefined, undefined)).toBe(true);
    expect(valueEqual(null, undefined)).toBe(true);
    expect(valueEqual(null, 'x')).toBe(false);
    expect(valueEqual('x', null)).toBe(false);
  });

  it('compares scalars by value', () => {
    expect(valueEqual('a', 'a')).toBe(true);
    expect(valueEqual('a', 'b')).toBe(false);
    expect(valueEqual(3, 3)).toBe(true);
    expect(valueEqual(3, 4)).toBe(false);
  });

  it('compares Decimals by numeric value, including Decimal-vs-string/number', () => {
    expect(valueEqual(dec('12.00'), dec('12'))).toBe(true);
    expect(valueEqual(dec('12.00'), dec('12.01'))).toBe(false);
    expect(valueEqual(dec('12.50'), 12.5)).toBe(true);
    expect(valueEqual(dec('12.50'), '12.50')).toBe(true);
  });

  it('compares Dates by timestamp', () => {
    expect(
      valueEqual(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z')),
    ).toBe(true);
    expect(
      valueEqual(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z')),
    ).toBe(false);
  });

  it('compares JSON objects independent of key order', () => {
    expect(valueEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(valueEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });
});

describe('jsonEqual', () => {
  it('handles nested objects and arrays', () => {
    expect(jsonEqual({ x: [1, { y: 2 }] }, { x: [1, { y: 2 }] })).toBe(true);
    expect(jsonEqual({ x: [1, { y: 2 }] }, { x: [1, { y: 3 }] })).toBe(false);
    expect(jsonEqual([1, 2, 3], [1, 2])).toBe(false);
  });

  it('distinguishes arrays from objects and null from object', () => {
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
  });
});

describe('valuesDiffer', () => {
  const existing = {
    title: 'Apple',
    quantity: 5,
    price: dec('9.99'),
    sku: null as string | null,
    shippingAddress: { city: 'Vancouver', zip: 'V5K' },
  };

  it('returns false when nothing changed (no-op write avoided)', () => {
    expect(
      valuesDiffer(existing, {
        title: 'Apple',
        quantity: 5,
        price: dec('9.99'),
        sku: null,
        shippingAddress: { zip: 'V5K', city: 'Vancouver' }, // reordered keys
      }),
    ).toBe(false);
  });

  it('detects a scalar change', () => {
    expect(valuesDiffer(existing, { quantity: 6 })).toBe(true);
  });

  it('detects a Decimal change', () => {
    expect(valuesDiffer(existing, { price: dec('10.00') })).toBe(true);
    expect(valuesDiffer(existing, { price: dec('9.99') })).toBe(false);
  });

  it('detects null -> value and value -> null', () => {
    expect(valuesDiffer(existing, { sku: 'SKU-1' })).toBe(true);
    expect(valuesDiffer({ ...existing, sku: 'SKU-1' }, { sku: null })).toBe(true);
  });

  it('detects a nested JSON change', () => {
    expect(
      valuesDiffer(existing, { shippingAddress: { city: 'Burnaby', zip: 'V5K' } }),
    ).toBe(true);
  });

  it('skips undefined keys (Prisma omits them, so they never write)', () => {
    expect(valuesDiffer(existing, { title: undefined, quantity: 5 })).toBe(false);
  });
});
