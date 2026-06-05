import 'dotenv/config';
import { prisma } from '../lib/core/prisma';
import { buildVendorLookup, supplierIdForLineItem, UNASSIGNED_SUPPLIER_ID } from '../features/order/office/mappers/vendor-supplier-map';

async function main() {
  const mappings = await prisma.shopifyVendorMapping.findMany({ select: { vendorName: true, supplierId: true, shopifyLocationGid: true } });
  const lookups = buildVendorLookup(mappings);
  const supName = new Map((await prisma.supplier.findMany({ select: { id: true, company: true } })).map(s => [s.id, s.company]));
  const nm = (id: string|null) => id ? (supName.get(id) ?? id) : '(none)';

  const pos = await prisma.purchaseOrder.findMany({
    where: { archivedAt: null, supplierId: { not: null } },
    select: { id: true, poNumber: true, createdAt: true, supplierId: true, supplier: { select: { shopifyVendorName: true } },
      lineItems: { where: { shopifyOrderLineItemId: { not: null } }, select: { id: true, shopifyOrderLineItem: { select: { vendor: true, shopifyLocationGid: true } } } } },
  });

  const pairCount = new Map<string, number>();
  const poCreatedForHit = new Map<string, Date>();
  let finalizedBlocked = 0;
  const confirmedLineIds: string[] = [];
  for (const po of pos) {
    const pv = po.supplier?.shopifyVendorName?.trim().toLowerCase() || null;
    if (!pv) continue;
    for (const l of po.lineItems) {
      const soli = l.shopifyOrderLineItem; if (!soli) continue;
      if ((soli.vendor?.trim().toLowerCase() || '') !== pv) continue;
      const r = supplierIdForLineItem({ vendor: soli.vendor, shopifyLocationGid: soli.shopifyLocationGid }, lookups);
      if (r === po.supplierId) continue;
      if (r === UNASSIGNED_SUPPLIER_ID) continue;
      const key = `${nm(po.supplierId)} → ${nm(r)}`;
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      confirmedLineIds.push(l.id);
      poCreatedForHit.set(po.id, po.createdAt);
    }
  }
  console.log('Confirmed-mismatch counts by (PO supplier → resolved supplier):');
  for (const [k, v] of [...pairCount.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v}`);

  const dates = [...poCreatedForHit.values()].sort((a,b)=>a.getTime()-b.getTime());
  console.log(`\nAffected POs: ${poCreatedForHit.size}. PO created range: ${dates[0]?.toISOString().slice(0,10)} .. ${dates[dates.length-1]?.toISOString().slice(0,10)}`);

  // how many of the confirmed lines have finalized fulfillments (cannot be safely deleted)
  const fin = await prisma.fulfillmentLineItem.findMany({ where: { purchaseOrderLineItemId: { in: confirmedLineIds }, finalizedAt: { not: null } }, select: { purchaseOrderLineItemId: true } });
  console.log(`Confirmed lines with FINALIZED fulfillments (delete would be skipped): ${new Set(fin.map(f=>f.purchaseOrderLineItemId)).size} / ${confirmedLineIds.length}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
