import { Prisma } from '@prisma/client';
import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { Suspense } from 'react';
import { OrderManagementView } from '@/features/order/office/views/OrderManagementView';
import { buildInboxData } from '@/features/order/office/mappers/build-inbox-data';
import { buildWeekPeriods } from '@/features/order/office/mappers/periods';
import {
  getShopifyAdminStoreHandleForOfficeUi,
  isShopifyAdminEnvConfigured,
} from '@/lib/shopify/env';
import {
  prismaPoCreatedByInclude,
  type PrismaPoWithRelations,
  type PrismaPoSlimWithRelations,
} from '@/features/order/office/mappers/map-purchase-order';
import type { PurchaseOrderStatus } from '@/features/order/office/types/purchase-order';
import { derivePurchaseOrderStatusFromShopify } from '@/lib/order/purchase-order-status-compute';
import { executeShopifySync } from '@/lib/shopify/sync/run-shopify-sync';
import { loadVariantOfficeNotesMap } from '@/lib/order/shopify-variant-office-note';
import { fetchLegacyOrphanPoLinesForInbox } from '@/lib/order/fetch-legacy-orphan-po-lines-for-inbox';
import OfficeOrderLoading from './loading';

export const dynamic = 'force-dynamic';

const UNLINKED_ORDERS_DAYS = 90;

export default async function OfficeOrderInboxPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/auth');

  // Run Shopify sync AFTER the response is sent so it never blocks page render.
  if (getOfficeOrAdmin(session.user.role) && isShopifyAdminEnvConfigured()) {
    after(async () => {
      const tSync = Date.now();
      try {
        const syncResult = await executeShopifySync('incremental');
        console.log(
          `[OfficeInbox] background sync ${Date.now() - tSync}ms — orders synced: ${syncResult.synced}/${syncResult.fetched}, customers: ${syncResult.customersSynced}`,
        );
      } catch (err) {
        console.error('[OfficeInbox] background sync failed:', err);
      }
    });
  }

  // Stream the page: shell renders immediately, data loads in background.
  return (
    <Suspense fallback={<OfficeOrderLoading />}>
      <OfficeInboxContent />
    </Suspense>
  );
}

async function OfficeInboxContent() {
  const t0 = Date.now();

  const unlinkedCutoff = new Date();
  unlinkedCutoff.setDate(unlinkedCutoff.getDate() - UNLINKED_ORDERS_DAYS);

  const [
    rawActivePOs,
    rawArchivedPOs,
    supplierGroups,
    unlinkedShopifyOrdersRaw,
    vendorMappings,
    rawLineCounts,
    rawReplacementOrders,
    replacementOrderCountRows,
  ] = await Promise.all([
    // Active POs — skip lineItems entirely; use _count for total, separate query for done counts
    prisma.purchaseOrder.findMany({
      where: { archivedAt: null },
      orderBy: [{ dateCreated: 'desc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { lineItems: true } },
        shopifyOrders: { include: { customer: true } },
        supplier: true,
        emailDeliveries: { orderBy: { sentAt: 'desc' } },
        createdBy: prismaPoCreatedByInclude,
        deliveryLocationPreset: {
          include: {
            locations: {
              select: { id: true, code: true, name: true },
              orderBy: { code: 'asc' },
            },
          },
        },
      },
    }),
    // Archived POs — no shopifyOrderLineItem, no emailDeliveries (not needed for sidebar)
    prisma.purchaseOrder.findMany({
      where: { archivedAt: { not: null } },
      orderBy: [{ dateCreated: 'desc' }, { createdAt: 'desc' }],
      include: {
        lineItems: { orderBy: { sequence: 'asc' } },
        shopifyOrders: { include: { customer: true } },
        supplier: true,
        createdBy: prismaPoCreatedByInclude,
        deliveryLocationPreset: {
          include: {
            locations: {
              select: { id: true, code: true, name: true },
              orderBy: { code: 'asc' },
            },
          },
        },
      },
      take: 100,
    }),
    prisma.supplierGroup.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        suppliers: { orderBy: { company: 'asc' } },
      },
    }),
    // Inbox Shopify orders: per-line open qty vs PO lines (FK’d); legacy orphan lines filled in buildInboxData.
    (async () => {
      const idRows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT o.id
        FROM "order".shopify_orders o
        WHERE o.is_custom_order IS NOT TRUE
          AND (o.display_fulfillment_status IS DISTINCT FROM 'FULFILLED')
          AND o.shopify_created_at >= ${unlinkedCutoff}
          AND (o.display_financial_status IS NULL OR o.display_financial_status IS DISTINCT FROM 'VOIDED')
          AND (
            NOT EXISTS (
              SELECT 1 FROM "order".shopify_order_line_items li WHERE li.order_id = o.id
            )
            OR EXISTS (
              SELECT 1
              FROM "order".shopify_order_line_items li
              WHERE li.order_id = o.id
                AND COALESCE(
                  (
                    SELECT SUM(poli.quantity)::int
                    FROM "order".purchase_order_line_items poli
                    INNER JOIN "order".purchase_orders po ON po.id = poli.purchase_order_id
                    WHERE poli.shopify_order_line_item_id = li.id
                  ),
                  0
                ) < li.quantity
            )
          )
      `);
      const ids = idRows.map((r) => r.id);
      if (ids.length === 0) return [];
      const rows = await prisma.shopifyOrder.findMany({
        where: { id: { in: ids } },
        orderBy: { shopifyCreatedAt: 'desc' },
        include: {
          customer: true,
          /** Detect order↔PO link with no FK’d lines (legacy / archived PO only). */
          purchaseOrders: { select: { archivedAt: true } },
          lineItems: {
            include: {
              purchaseOrderLineItems: {
                select: { id: true, quantity: true },
              },
            },
          },
        },
      });
      return rows;
    })(),
    prisma.shopifyVendorMapping.findMany({
      select: { vendorName: true, supplierId: true, shopifyLocationGid: true },
    }),
    // Fulfillment counts per PO via DB aggregation — avoids fetching every row individually.
    // done_by_qty: lines where qty <= 0 (placeholder) or fully received.
    // shopify_linked_undone: lines with open qty that are FK'd to a Shopify line (for mirror-fulfilled logic).
    prisma.$queryRaw<Array<{
      purchase_order_id: string;
      total: number;
      done_by_qty: number;
      shopify_linked_undone: number;
    }>>(Prisma.sql`
      SELECT
        purchase_order_id,
        COUNT(*)::int                                                                        AS total,
        COUNT(*) FILTER (WHERE quantity <= 0 OR quantity_received >= quantity)::int         AS done_by_qty,
        COUNT(*) FILTER (
          WHERE quantity > 0
            AND quantity_received < quantity
            AND shopify_order_line_item_id IS NOT NULL
        )::int                                                                              AS shopify_linked_undone
      FROM "order".purchase_order_line_items
      WHERE purchase_order_id IN (
        SELECT id FROM "order".purchase_orders WHERE archived_at IS NULL
      )
      GROUP BY purchase_order_id
    `),
    // Custom orders (internally created for missing/damaged items)
    prisma.shopifyOrder.findMany({
      where: { isReplacementOrder: true, archivedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: true,
        purchaseOrders: { select: { archivedAt: true } },
        lineItems: {
          include: {
            purchaseOrderLineItems: { select: { id: true, quantity: true } },
          },
        },
      },
    }),
    // Count custom orders per source PO for the badge in PoTable
    prisma.shopifyOrder.groupBy({
      by: ['sourcePurchaseOrderId'],
      where: { isReplacementOrder: true, archivedAt: null, sourcePurchaseOrderId: { not: null } },
      _count: { id: true },
    }),
  ]);

  // Merge regular Shopify orders with custom orders for the inbox
  const unlinkedShopifyOrders = [
    ...unlinkedShopifyOrdersRaw,
    ...(rawReplacementOrders as unknown as typeof unlinkedShopifyOrdersRaw),
  ];

  // Build per-PO custom order count map for PoTable badge
  const replacementOrderCountByPoId = new Map<string, number>(
    replacementOrderCountRows
      .filter((r) => r.sourcePurchaseOrderId != null)
      .map((r) => [r.sourcePurchaseOrderId as string, r._count.id]),
  );

  const activePurchaseOrders = rawActivePOs as unknown as PrismaPoSlimWithRelations[];

  /** When linked Shopify orders are all fulfilled, FK’d lines mirror FULFILLED in UI (hub recv may lag). */
  const mirrorFulfilledByPoId = new Map<string, boolean>(
    activePurchaseOrders.map((po) => {
      const derived = derivePurchaseOrderStatusFromShopify(
        po.shopifyOrders.map((o) => ({
          displayFulfillmentStatus: o.displayFulfillmentStatus,
        })),
        po.completedAt,
      );
      const s = po.status as PurchaseOrderStatus;
      const mirror =
        derived === 'fulfilled' ||
        derived === 'completed' ||
        s === 'fulfilled' ||
        s === 'completed';
      return [po.id, mirror] as const;
    }),
  );

  // Build per-PO fulfillment counts from DB aggregation.
  // Mirror-fulfilled POs count FK'd open lines as done (Shopify FULFILLED mirrors hub receipt).
  const lineCountsByPoId = new Map<string, { total: number; done: number }>();
  for (const row of rawLineCounts) {
    const mirror = mirrorFulfilledByPoId.get(row.purchase_order_id) ?? false;
    const done = mirror
      ? row.done_by_qty + row.shopify_linked_undone
      : row.done_by_qty;
    lineCountsByPoId.set(row.purchase_order_id, { total: row.total, done });
  }

  const archivedPurchaseOrders = rawArchivedPOs.map((po) => ({
    ...po,
    lineItems: po.lineItems.map((li) => ({ ...li, shopifyOrderLineItem: null })),
    emailDeliveries: [],
  })) as unknown as PrismaPoWithRelations[];

  console.log(
    `[OfficeInbox] DB loaded in ${Date.now() - t0}ms — ${activePurchaseOrders.length} active + ${archivedPurchaseOrders.length} archived POs, ${unlinkedShopifyOrders.length} unlinked orders`,
  );

  const variantGidsForNotes = new Set<string>();
  for (const o of unlinkedShopifyOrders) {
    for (const li of o.lineItems) {
      const g = li.variantGid?.trim();
      if (g) variantGidsForNotes.add(g);
    }
  }
  const unlinkedOrderIds = unlinkedShopifyOrders.map((o) => o.id);

  const [
    variantDefaultLineNotes,
    legacyOrphanPoLines,
    customerScheduleOverrides,
    deliveryPresets,
    presetCustomerExceptions,
  ] = await Promise.all([
    loadVariantOfficeNotesMap(prisma, [...variantGidsForNotes]),
    fetchLegacyOrphanPoLinesForInbox(prisma, unlinkedOrderIds),
    prisma.supplierCustomerDeliverySchedule.findMany({
      select: { customerId: true, supplierId: true, schedule: true },
    }),
    prisma.deliverySchedulePreset.findMany({
      select: { id: true, windows: true },
    }),
    prisma.deliverySchedulePresetCustomerException.findMany({
      select: { presetId: true, customerId: true, windows: true },
    }),
  ]);

  const inbox = buildInboxData(
    activePurchaseOrders,
    archivedPurchaseOrders,
    supplierGroups,
    unlinkedShopifyOrders,
    vendorMappings,
    lineCountsByPoId,
    variantDefaultLineNotes,
    legacyOrphanPoLines,
    replacementOrderCountByPoId,
    customerScheduleOverrides,
    deliveryPresets,
    presetCustomerExceptions,
  );

  const periods = buildWeekPeriods();
  const shopifyAdminStoreHandle = getShopifyAdminStoreHandleForOfficeUi();

  return (
    <OrderManagementView
      shopifyAdminApiConfigured={isShopifyAdminEnvConfigured()}
      shopifyAdminStoreHandle={shopifyAdminStoreHandle}
      initialStates={inbox.initialStates}
      viewDataMap={inbox.viewDataMap}
      customerGroups={inbox.customerGroups}
      supplierGroupFilterOptions={inbox.supplierGroupFilterOptions}
      statusTabCounts={inbox.statusTabCounts}
      defaultActiveKey={inbox.defaultActiveKey}
      periods={periods}
    />
  );
}
