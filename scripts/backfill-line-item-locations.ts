/**
 * One-off backfill: populate `shopifyLocationGid` on ShopifyOrderLineItem rows
 * that were left null by the old no-op-write guard (`{ not: locationGid }`, which
 * never matched NULL rows). Without a location these lines fall back to vendor-only
 * supplier mapping and land under the wrong supplier in the office inbox.
 *
 * Scope: open (non-FULFILLED) orders that still have at least one null-location
 * line item — i.e. the orders that actually show up in the inbox. Idempotent.
 *
 * Run:  npx tsx scripts/backfill-line-item-locations.ts        (dry run)
 *       npx tsx scripts/backfill-line-item-locations.ts --apply
 */
import 'dotenv/config';
import { prisma } from '../lib/core/prisma';
import { createShopifyAdminGraphqlClient } from '../lib/shopify/createFulfillment';
import { getShopifyAdminEnv, isShopifyAdminEnvConfigured } from '../lib/shopify/env';
import { fetchFulfillmentOrderLocations } from '../lib/shopify/fetchFulfillmentOrderLocations';

async function main() {
  const apply = process.argv.includes('--apply');
  if (!isShopifyAdminEnvConfigured()) {
    console.error('Shopify admin env not configured — aborting.');
    return;
  }
  const client = createShopifyAdminGraphqlClient(getShopifyAdminEnv());

  const orders = await prisma.shopifyOrder.findMany({
    where: {
      displayFulfillmentStatus: { not: 'FULFILLED' },
      lineItems: { some: { shopifyLocationGid: null } },
    },
    select: {
      id: true,
      name: true,
      shopifyGid: true,
      lineItems: { where: { shopifyLocationGid: null }, select: { id: true, shopifyGid: true } },
    },
  });

  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${orders.length} orders with null-location lines`);
  let updated = 0;
  let unresolved = 0;
  for (const o of orders) {
    const map = await fetchFulfillmentOrderLocations(client, o.shopifyGid);
    for (const li of o.lineItems) {
      const loc = map.get(li.shopifyGid);
      if (!loc) { unresolved++; continue; }
      if (apply) {
        await prisma.shopifyOrderLineItem.updateMany({
          where: { id: li.id, shopifyLocationGid: null },
          data: { shopifyLocationGid: loc },
        });
      }
      updated++;
    }
  }
  console.log(`${apply ? 'Updated' : 'Would update'}: ${updated} line items | unresolved (no FO location): ${unresolved}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
