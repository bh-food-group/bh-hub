export const UNASSIGNED_SUPPLIER_ID = '__unassigned__';

export type VendorMapping = { vendorName: string; supplierId: string; shopifyLocationGid?: string | null };

export type VendorLookups = {
  /** (vendorName + ":" + locationGid) → supplierId — location-specific, takes priority */
  byLocation: Map<string, string>;
  /** vendorName → supplierId — default fallback when no location match */
  byVendor: Map<string, string>;
};

export function buildVendorLookup(vendorMappings: VendorMapping[]): VendorLookups {
  const byLocation = new Map<string, string>();
  const byVendor = new Map<string, string>();
  for (const m of vendorMappings) {
    const vendor = m.vendorName.trim();
    if (!vendor) continue;
    if (m.shopifyLocationGid) {
      byLocation.set(`${vendor}:${m.shopifyLocationGid}`, m.supplierId);
    } else {
      byVendor.set(vendor, m.supplierId);
    }
  }
  return { byLocation, byVendor };
}

export function supplierIdForLineItem(
  li: { vendor?: string | null; shopifyLocationGid?: string | null },
  lookups: VendorLookups,
): string {
  const vendor = li.vendor?.trim();
  if (!vendor) return UNASSIGNED_SUPPLIER_ID;
  if (li.shopifyLocationGid) {
    const located = lookups.byLocation.get(`${vendor}:${li.shopifyLocationGid}`);
    if (located) return located;
  }
  return lookups.byVendor.get(vendor) ?? UNASSIGNED_SUPPLIER_ID;
}
