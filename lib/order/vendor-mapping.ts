import { prisma } from '@/lib/core/prisma';

type VendorMappingPair = {
  vendorName: string;
  shopifyLocationGid?: string | null;
  shopifyLocationName?: string | null;
};

/**
 * Upsert a single (vendorName, shopifyLocationGid) → supplierId mapping.
 * Uses findFirst + create/update because Prisma upsert doesn't handle
 * nullable fields in compound unique keys cleanly.
 */
export async function upsertVendorMapping(
  supplierId: string,
  pair: VendorMappingPair,
): Promise<void> {
  const locationGid = pair.shopifyLocationGid ?? null;
  const existing = await prisma.shopifyVendorMapping.findFirst({
    where: { vendorName: pair.vendorName, shopifyLocationGid: locationGid },
    select: { id: true },
  });
  if (existing) {
    await prisma.shopifyVendorMapping.update({
      where: { id: existing.id },
      data: {
        supplierId,
        ...(pair.shopifyLocationName !== undefined && {
          shopifyLocationName: pair.shopifyLocationName ?? null,
        }),
      },
    });
  } else {
    await prisma.shopifyVendorMapping.create({
      data: {
        vendorName: pair.vendorName,
        shopifyLocationGid: locationGid,
        shopifyLocationName: pair.shopifyLocationName ?? null,
        supplierId,
      },
    });
  }
}

/**
 * Sync all (vendorName, locationGid) pairs for a supplier.
 * Deletes pairs that are no longer in the desired set, upserts the desired ones.
 * Only manages mappings belonging to this supplier (won't touch other suppliers' mappings).
 */
export async function syncLocationVendorPairs(
  supplierId: string,
  desiredPairs: VendorMappingPair[],
): Promise<void> {
  const current = await prisma.shopifyVendorMapping.findMany({
    where: { supplierId, shopifyLocationGid: { not: null } },
    select: { id: true, vendorName: true, shopifyLocationGid: true },
  });

  // Key for dedup: "vendorName:locationGid" (null → empty string for keying)
  const pairKey = (v: string, l: string | null | undefined) =>
    `${v}:${l ?? ''}`;

  const desiredKeys = new Set(
    desiredPairs.map((p) => pairKey(p.vendorName, p.shopifyLocationGid)),
  );

  // Delete pairs no longer desired
  const toDelete = current
    .filter((c) => !desiredKeys.has(pairKey(c.vendorName, c.shopifyLocationGid)))
    .map((c) => c.id);

  if (toDelete.length > 0) {
    await prisma.shopifyVendorMapping.deleteMany({ where: { id: { in: toDelete } } });
  }

  // Upsert desired pairs
  for (const pair of desiredPairs) {
    await upsertVendorMapping(supplierId, pair);
  }
}
