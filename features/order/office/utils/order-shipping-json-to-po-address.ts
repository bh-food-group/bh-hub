import type { PoAddress } from '../types/purchase-order';

type OrderShipJson = {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  zip?: string | null;
  postalCode?: string | null;
};

/**
 * `ShopifyOrder.shippingAddress` JSON (from `addressToJson` / Shopify node) → PO form shape.
 * Returns null when required fields are missing (cannot satisfy PO create `addressSchema`).
 */
export function orderShippingJsonToPoAddress(json: unknown): PoAddress | null {
  if (json == null || typeof json !== 'object') return null;
  const o = json as OrderShipJson;
  const address1 = (o.address1 ?? '').trim();
  const city = (o.city ?? '').trim();
  const province = (o.province ?? '').trim();
  const postalCode = (o.postalCode ?? o.zip ?? '').trim();
  if (!address1 || !city || !province || !postalCode) return null;
  const address2 = (o.address2 ?? '').trim();
  return {
    address1,
    ...(address2 ? { address2 } : {}),
    city,
    province,
    postalCode,
    country: (o.country ?? 'CA').trim() || 'CA',
  };
}

/** One-line label for Separate PO “Ship to” default (structured row, else flattened inbox line). */
export function formatDefaultShipToLine(order: {
  defaultPoShippingAddress: PoAddress | null;
  shippingAddressLine: string | null;
}): string {
  const a = order.defaultPoShippingAddress;
  if (a?.address1?.trim()) {
    return [a.address1, a.address2, a.city, a.province, a.postalCode].filter(Boolean).join(', ');
  }
  return (order.shippingAddressLine ?? '').trim();
}

/**
 * Resolves `shippingAddress` for POST /api/order/purchase-orders from the single-line field.
 * When the order has a structured default, edits replace `address1` only so city/PC stay valid.
 */
export function resolveSeparatePoShippingAddress(
  shipTo: string,
  order: { defaultPoShippingAddress: PoAddress | null },
  initialOneLineLabel: string,
): PoAddress | null {
  const trimmed = shipTo.trim();
  if (!trimmed) return null;
  const def = order.defaultPoShippingAddress;
  if (def && trimmed === initialOneLineLabel.trim()) return def;
  if (def) return { ...def, address1: trimmed };
  return null;
}
