import type { Prisma } from '@prisma/client';
import type { LegacyOrphanPoLineForInbox } from '@/lib/order/fetch-legacy-orphan-po-lines-for-inbox';

export type ShopifyOrderForLegacyAlloc = Prisma.ShopifyOrderGetPayload<{
  include: {
    customer: true;
    purchaseOrders: { select: { archivedAt: true } };
    lineItems: {
      include: {
        purchaseOrderLineItems: { select: { id: true; quantity: true } };
      };
    };
  };
}>;

const LEGACY_POOL_KEY_SEP = '\x1e';

function inboxLineBucketKey(variantGid: string | null | undefined, sku: string | null | undefined): string | null {
  const v = variantGid?.trim();
  if (v) return `v:${v}`;
  const s = sku?.trim();
  if (s) return `s:${s.toLowerCase()}`;
  return null;
}

function fkPoQtyOnShopifyLine(li: ShopifyOrderForLegacyAlloc['lineItems'][number]): number {
  let q = 0;
  for (const pol of li.purchaseOrderLineItems ?? []) q += pol.quantity ?? 0;
  return q;
}

/**
 * Legacy CSV PO lines are not FK'd to `shopify_order_line_items`. FIFO-allocates
 * orphan qty across inbox-candidate Shopify lines per PO/bucket (variant GID → SKU).
 * Returns a map of shopify_order_line_item.id → extra covered qty.
 */
export function buildLegacyExtraQtyByShopifyLineItemId(
  orders: ShopifyOrderForLegacyAlloc[],
  legacyRows: LegacyOrphanPoLineForInbox[],
): Map<string, number> {
  const extra = new Map<string, number>();
  if (legacyRows.length === 0) return extra;

  const candidateOrderIds = new Set(orders.map((o) => o.id));
  const poolByPoAndBucket = new Map<string, number>();
  const linkedCandidateOrderIdsByPo = new Map<string, Set<string>>();

  for (const row of legacyRows) {
    const poId = row.purchaseOrder.id;
    const linked = row.purchaseOrder.shopifyOrders.map((o) => o.id);
    const relevant = linked.filter((id) => candidateOrderIds.has(id));
    if (relevant.length === 0) continue;

    let set = linkedCandidateOrderIdsByPo.get(poId);
    if (!set) { set = new Set(); linkedCandidateOrderIdsByPo.set(poId, set); }
    for (const id of relevant) set.add(id);

    const k = inboxLineBucketKey(row.shopifyVariantGid, row.sku);
    if (!k) continue;
    const poolKey = `${poId}${LEGACY_POOL_KEY_SEP}${k}`;
    poolByPoAndBucket.set(poolKey, (poolByPoAndBucket.get(poolKey) ?? 0) + (row.quantity ?? 0));
  }

  type Li = ShopifyOrderForLegacyAlloc['lineItems'][number];
  const linesByPoAndBucket = new Map<string, Li[]>();
  const lineIdToOrderId = new Map<string, string>();
  const orderIdToLinkedPoIds = new Map<string, string[]>();

  for (const [poId, allowed] of linkedCandidateOrderIdsByPo) {
    for (const oid of allowed) {
      if (!orderIdToLinkedPoIds.has(oid)) orderIdToLinkedPoIds.set(oid, []);
      orderIdToLinkedPoIds.get(oid)!.push(poId);
    }
  }

  for (const order of orders) {
    const oid = order.id;
    const rawPoIds = orderIdToLinkedPoIds.get(oid);
    if (!rawPoIds?.length) continue;
    const poIdsForOrder = [...new Set(rawPoIds)];

    for (const li of order.lineItems) {
      if ((li.quantity ?? 0) <= 0) continue;
      lineIdToOrderId.set(li.id, oid);
      const k = inboxLineBucketKey(li.variantGid, li.sku);
      if (!k) continue;
      for (const poId of poIdsForOrder) {
        const key = `${poId}${LEGACY_POOL_KEY_SEP}${k}`;
        if (!poolByPoAndBucket.has(key)) continue;
        if (!linesByPoAndBucket.has(key)) linesByPoAndBucket.set(key, []);
        linesByPoAndBucket.get(key)!.push(li);
      }
    }
  }

  for (const [, list] of linesByPoAndBucket) {
    list.sort((a, b) => {
      const ca = lineIdToOrderId.get(a.id) ?? '';
      const cb = lineIdToOrderId.get(b.id) ?? '';
      if (ca !== cb) return ca.localeCompare(cb);
      return a.id.localeCompare(b.id);
    });
  }

  const sortedPoolKeys = [...poolByPoAndBucket.keys()].sort();
  for (const poolKey of sortedPoolKeys) {
    let pool = poolByPoAndBucket.get(poolKey) ?? 0;
    if (pool <= 0) continue;
    const lines = linesByPoAndBucket.get(poolKey);
    if (!lines?.length) continue;
    for (const li of lines) {
      if (pool <= 0) break;
      const lineQty = li.quantity ?? 0;
      const fk = fkPoQtyOnShopifyLine(li);
      const assigned = extra.get(li.id) ?? 0;
      const cap = Math.max(0, lineQty - fk - assigned);
      const take = Math.min(cap, pool);
      if (take > 0) { extra.set(li.id, assigned + take); pool -= take; }
    }
  }

  return extra;
}

/** Qty covered by FK'd PO lines + legacy orphan allocation. */
export function linkedPoQtyOnShopifyLine(
  li: ShopifyOrderForLegacyAlloc['lineItems'][number],
  legacyExtraQtyByShopifyLineItemId: Map<string, number>,
): number {
  let q = 0;
  for (const pol of li.purchaseOrderLineItems ?? []) q += pol.quantity ?? 0;
  return q + (legacyExtraQtyByShopifyLineItemId.get(li.id) ?? 0);
}

/** Units of this Shopify line not yet on any PO. */
export function shopifyLineRemainingQty(
  li: ShopifyOrderForLegacyAlloc['lineItems'][number],
  legacyExtraQtyByShopifyLineItemId: Map<string, number>,
): number {
  return Math.max(0, (li.quantity ?? 0) - linkedPoQtyOnShopifyLine(li, legacyExtraQtyByShopifyLineItemId));
}
