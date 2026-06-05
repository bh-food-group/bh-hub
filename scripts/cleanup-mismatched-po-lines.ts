/**
 * Find (and optionally delete) PurchaseOrderLineItem rows that were wrongly
 * swept into a PO by the old "append on save" bug.
 *
 * Background: `resyncPurchaseOrderLineItemsFromShopify` used to append every
 * unlinked line on the edited Shopify order, filtered ONLY by vendor *name*
 * against the PO supplier's `shopifyVendorName` (ignoring `shopifyLocationGid`).
 * For a supplier defined purely by an inventory+vendor mapping with NO
 * shopifyVendorName (e.g. R&D = `Millda @ Gongyou Kitchen`), the name filter was
 * null and skipped, so the append swept in EVERY unlinked line on that Shopify
 * order — other locations of the same vendor, and entirely different vendors.
 * The resync code now uses the location-aware `supplierIdForLineItem` rule.
 *
 * IMPORTANT: a PO legitimately containing lines that bucket to another supplier
 * is NOT always a bug — some vendor names map to different suppliers by location
 * on purpose (e.g. vendor "HQ" @ "Head Office" → BH is intended). So this script
 * REQUIRES an explicit `--supplier` or `--po` scope and never runs globally. A
 * line is flagged when its ShopifyOrderLineItem's (vendor + location) does NOT
 * resolve — under the same global ShopifyVendorMapping lookup the inbox uses — to
 * the PO's own supplier. Review the dry-run before `--apply`. Deletion respects
 * finalized fulfillments (those are skipped).
 *
 * Usage (dry-run unless --apply):
 *   tsx scripts/cleanup-mismatched-po-lines.ts --supplier="R&D"
 *   tsx scripts/cleanup-mismatched-po-lines.ts --po=<poId>
 *   tsx scripts/cleanup-mismatched-po-lines.ts --supplier="R&D" --apply
 *   tsx scripts/cleanup-mismatched-po-lines.ts --supplier="R&D" --apply --include-archived
 *
 * Requires DATABASE_URL.
 */

import 'dotenv/config';
import { prisma } from '../lib/core/prisma';
import {
  buildVendorLookup,
  supplierIdForLineItem,
  UNASSIGNED_SUPPLIER_ID,
} from '../features/order/office/mappers/vendor-supplier-map';
import { deletePurchaseOrderLineItemIfNoFinalizedFulfillments } from '../lib/order/purchase-order-line-item-delete-if-safe';
import { recomputePurchaseOrderStatusById } from '../lib/order/purchase-order-status';

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}
function flagValue(name: string): string | null {
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

async function main() {
  const apply = hasFlag('--apply');
  const includeArchived = hasFlag('--include-archived');
  const onlyPoId = flagValue('--po');
  const supplierName = flagValue('--supplier');

  if (!onlyPoId && !supplierName) {
    console.error(
      'Refusing to run globally. Scope with --supplier="<company>" or --po=<id>.\n' +
        '(Cross-supplier lines can be intentional — e.g. vendor "HQ" @ "Head Office" → BH.)',
    );
    process.exitCode = 1;
    return;
  }

  const mappings = await prisma.shopifyVendorMapping.findMany({
    select: {
      vendorName: true,
      supplierId: true,
      shopifyLocationGid: true,
      shopifyLocationName: true,
    },
  });
  const lookups = buildVendorLookup(mappings);
  // gid → human location name (best-effort, from mapping rows).
  const locNameByGid = new Map<string, string>();
  for (const m of mappings) {
    if (m.shopifyLocationGid && m.shopifyLocationName) {
      locNameByGid.set(m.shopifyLocationGid, m.shopifyLocationName);
    }
  }
  const locLabel = (gid: string | null) =>
    gid ? (locNameByGid.get(gid) ?? gid) : '(no location)';

  const supplierNameById = new Map<string, string>();
  for (const s of await prisma.supplier.findMany({
    select: { id: true, company: true },
  })) {
    supplierNameById.set(s.id, s.company);
  }
  const nameOf = (id: string | null) =>
    id ? (supplierNameById.get(id) ?? id) : '(none)';

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      ...(onlyPoId ? { id: onlyPoId } : {}),
      ...(supplierName
        ? { supplier: { is: { company: supplierName } } }
        : {}),
      ...(includeArchived ? {} : { archivedAt: null }),
      supplierId: { not: null },
    },
    select: {
      id: true,
      poNumber: true,
      supplierId: true,
      lineItems: {
        where: { shopifyOrderLineItemId: { not: null } },
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          productTitle: true,
          shopifyOrderLineItem: {
            select: { vendor: true, shopifyLocationGid: true },
          },
        },
      },
    },
  });

  if (pos.length === 0) {
    console.log('No POs matched the scope. Nothing to do.');
    return;
  }

  type Hit = {
    poId: string;
    poNumber: string | null;
    poSupplierId: string;
    lineId: string;
    title: string;
    vendor: string | null;
    locationGid: string | null;
    resolvedSupplierId: string;
  };
  const hits: Hit[] = [];

  for (const po of pos) {
    const poSupplierId = po.supplierId!;
    for (const line of po.lineItems) {
      const soli = line.shopifyOrderLineItem;
      if (!soli) continue;
      const resolved = supplierIdForLineItem(
        { vendor: soli.vendor, shopifyLocationGid: soli.shopifyLocationGid },
        lookups,
      );
      if (resolved === poSupplierId) continue; // legitimately belongs here
      hits.push({
        poId: po.id,
        poNumber: po.poNumber,
        poSupplierId,
        lineId: line.id,
        title: line.productTitle ?? '(untitled)',
        vendor: soli.vendor,
        locationGid: soli.shopifyLocationGid,
        resolvedSupplierId: resolved,
      });
    }
  }

  console.log(
    `Scope: ${supplierName ? `supplier="${supplierName}"` : `po=${onlyPoId}`}` +
      `${includeArchived ? ' (incl. archived)' : ''}. ` +
      `Scanned ${pos.length} PO(s). Lines not belonging to the PO supplier: ${hits.length}.\n`,
  );

  // Group by PO for readability.
  const byPo = new Map<string, Hit[]>();
  for (const h of hits) {
    const arr = byPo.get(h.poId) ?? [];
    arr.push(h);
    byPo.set(h.poId, arr);
  }
  for (const [, arr] of byPo) {
    const first = arr[0];
    console.log(
      `── PO ${first.poNumber ?? first.poId} [supplier: ${nameOf(first.poSupplierId)}] — ${arr.length} line(s) ──`,
    );
    for (const h of arr) {
      console.log(
        `   "${h.title}" vendor="${h.vendor ?? ''}" @ ${locLabel(h.locationGid)} ` +
          `→ ${nameOf(h.resolvedSupplierId === UNASSIGNED_SUPPLIER_ID ? null : h.resolvedSupplierId)}` +
          `${h.resolvedSupplierId === UNASSIGNED_SUPPLIER_ID ? ' (unassigned)' : ''} [${h.lineId}]`,
      );
    }
    console.log('');
  }

  if (!apply) {
    console.log('Dry-run. Re-run with --apply to delete these lines.');
    return;
  }

  let deleted = 0;
  let skipped = 0;
  const touchedPoIds = new Set<string>();
  for (const h of hits) {
    const ok = await deletePurchaseOrderLineItemIfNoFinalizedFulfillments(
      h.lineId,
    );
    if (ok) {
      deleted++;
      touchedPoIds.add(h.poId);
    } else {
      skipped++;
      console.log(
        `  SKIP (finalized fulfillment) PO ${h.poNumber ?? h.poId} "${h.title}" [${h.lineId}]`,
      );
    }
  }
  for (const poId of touchedPoIds) {
    await recomputePurchaseOrderStatusById(poId);
  }
  console.log(
    `\nDeleted ${deleted} line(s) across ${touchedPoIds.size} PO(s). Skipped ${skipped} (finalized).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
