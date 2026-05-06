/**
 * Backfill empty RefundReplacementRecord rows for all existing replacement orders
 * that don't already have records.
 *
 * Creates one record per line item with empty reason strings so these orders
 * appear in the Refunds & Replacements view (with editable reasons).
 *
 * Usage:
 *   npx tsx scripts/backfill-replacement-records.ts
 *   npx tsx scripts/backfill-replacement-records.ts --dry-run
 */

import 'dotenv/config';
import { prisma } from '../lib/core/prisma';

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}\n`);

  // Find all replacement orders that have no RefundReplacementRecord yet.
  const replacementOrders = await prisma.shopifyOrder.findMany({
    where: {
      isReplacementOrder: true,
    },
    select: {
      id: true,
      name: true,
      sourcePurchaseOrderId: true,
      lineItems: {
        select: {
          id: true,
          title: true,
          variantTitle: true,
          sku: true,
          quantity: true,
          price: true,
          sourcePurchaseOrderLineItemId: true,
        },
      },
    },
    orderBy: { shopifyCreatedAt: 'asc' },
  });

  console.log(`Found ${replacementOrders.length} total replacement orders.`);

  // Get replacement order IDs that already have records.
  const existingRecords = await prisma.refundReplacementRecord.findMany({
    where: {
      replacementOrderId: { in: replacementOrders.map((o) => o.id) },
    },
    select: { replacementOrderId: true },
  });

  const alreadyBackfilled = new Set(
    existingRecords.map((r) => r.replacementOrderId).filter(Boolean) as string[],
  );

  const toBackfill = replacementOrders.filter(
    (o) => !alreadyBackfilled.has(o.id),
  );

  console.log(`Already backfilled: ${alreadyBackfilled.size}`);
  console.log(`Need backfill: ${toBackfill.length}\n`);

  if (toBackfill.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let totalRecords = 0;
  let skipped = 0;

  for (const order of toBackfill) {
    if (!order.sourcePurchaseOrderId) {
      console.log(`  SKIP ${order.name} (${order.id}) — no sourcePurchaseOrderId`);
      skipped++;
      continue;
    }

    const records = order.lineItems.map((li) => ({
      type: 'replacement' as const,
      reasonCategory: '',
      reasonSubcategory: '',
      reasonNotes: null,
      purchaseOrderId: order.sourcePurchaseOrderId!,
      purchaseOrderLineItemId: li.sourcePurchaseOrderLineItemId ?? null,
      replacementOrderId: order.id,
      productTitle: li.title,
      variantTitle: li.variantTitle ?? null,
      sku: li.sku ?? null,
      quantity: li.quantity,
      unitPrice: li.price ?? null,
      createdById: null,
    }));

    console.log(
      `  ${isDryRun ? '[DRY] ' : ''}${order.name} (${order.id}) — ${records.length} line item(s)`,
    );

    if (!isDryRun) {
      await prisma.refundReplacementRecord.createMany({ data: records });
    }

    totalRecords += records.length;
  }

  console.log(
    `\n${isDryRun ? '[DRY RUN] Would create' : 'Created'} ${totalRecords} record(s) across ${toBackfill.length - skipped} order(s). Skipped: ${skipped}.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
