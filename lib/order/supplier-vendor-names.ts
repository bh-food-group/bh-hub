import { prisma } from '@/lib/core/prisma';

/**
 * All Shopify vendor names that map to a supplier: the supplier's canonical
 * `shopifyVendorName` plus every `ShopifyVendorMapping.vendorName` (one supplier
 * can collect several vendor names across locations). Used to scope the office
 * "add line" product search so only that supplier's items are offered.
 *
 * Returns an empty array when the supplier has no usable vendor names (e.g. the
 * unassigned bucket) — callers should treat that as "no matching products".
 */
export async function vendorNamesForSupplierId(
  supplierId: string,
): Promise<string[]> {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: {
      shopifyVendorName: true,
      vendorMappings: { select: { vendorName: true } },
    },
  });
  if (!supplier) return [];
  const names = new Set<string>();
  const add = (v: string | null | undefined) => {
    const t = v?.trim();
    if (t) names.add(t);
  };
  add(supplier.shopifyVendorName);
  for (const m of supplier.vendorMappings) add(m.vendorName);
  return [...names];
}

/** Same as {@link vendorNamesForSupplierId} but resolves the supplier from a PO. */
export async function vendorNamesForPurchaseOrderId(
  purchaseOrderId: string,
): Promise<string[]> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { supplierId: true },
  });
  if (!po?.supplierId) return [];
  return vendorNamesForSupplierId(po.supplierId);
}
