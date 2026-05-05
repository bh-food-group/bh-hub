import { Prisma } from '@prisma/client';
import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { Suspense } from 'react';
import { OrderManagementView } from '@/features/order/office/views/OrderManagementView';
import { OFFICE_TABLE_VIEW_FETCH_LIMIT } from '@/features/order/office/constants/office-table-view';
import {
  fetchPurchaseOrdersForOfficeTableView,
  fetchShopifyOrdersForOfficeTableView,
} from '@/lib/order/office-table-view-fetch';
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
    tableViewShopifyTotal,
    tableViewPoTotal,
    tableViewShopifyRows,
    tableViewPoRows,
    rawCustomOrders,
    customOrderCountRows,
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
        WHERE (o.display_fulfillment_status IS DISTINCT FROM 'FULFILLED')
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
      select: { vendorName: true, supplierId: true },
    }),
    // Minimal line-item data for fulfillment counts (FK used for Shopify-mirror rules)
    prisma.purchaseOrderLineItem.findMany({
      where: { purchaseOrder: { archivedAt: null } },
      select: {
        purchaseOrderId: true,
        quantity: true,
        quantityReceived: true,
        shopifyOrderLineItemId: true,
      },
    }),
    prisma.shopifyOrder.count(),
    prisma.purchaseOrder.count(),
    fetchShopifyOrdersForOfficeTableView(0, OFFICE_TABLE_VIEW_FETCH_LIMIT),
    fetchPurchaseOrdersForOfficeTableView(0, OFFICE_TABLE_VIEW_FETCH_LIMIT),
    // Custom orders (internally created for missing/damaged items)
    prisma.shopifyOrder.findMany({
      where: { isCustomOrder: true, archivedAt: null },
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
      where: { isCustomOrder: true, archivedAt: null, sourcePurchaseOrderId: { not: null } },
      _count: { id: true },
    }),
  ]);

  // Merge regular Shopify orders with custom orders for the inbox
  const unlinkedShopifyOrders = [
    ...unlinkedShopifyOrdersRaw,
    ...(rawCustomOrders as unknown as typeof unlinkedShopifyOrdersRaw),
  ];

  // Build per-PO custom order count map for PoTable badge
  const customOrderCountByPoId = new Map<string, number>(
    customOrderCountRows
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

  // Build per-PO fulfillment counts from the minimal line query
  const lineCountsByPoId = new Map<string, { total: number; done: number }>();
  for (const li of rawLineCounts) {
    const cur = lineCountsByPoId.get(li.purchaseOrderId) ?? { total: 0, done: 0 };
    cur.total++;
    const qty = li.quantity;
    const recv = li.quantityReceived;
    if (qty <= 0 || recv >= qty) {
      cur.done++;
    } else if (
      (mirrorFulfilledByPoId.get(li.purchaseOrderId) ?? false) &&
      li.shopifyOrderLineItemId
    ) {
      cur.done++;
    }
    lineCountsByPoId.set(li.purchaseOrderId, cur);
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
  const variantDefaultLineNotes = await loadVariantOfficeNotesMap(
    prisma,
    [...variantGidsForNotes],
  );

  const legacyOrphanPoLines = await fetchLegacyOrphanPoLinesForInbox(
    prisma,
    unlinkedShopifyOrders.map((o) => o.id),
  );

  const inbox = buildInboxData(
    activePurchaseOrders,
    archivedPurchaseOrders,
    supplierGroups,
    unlinkedShopifyOrders,
    vendorMappings,
    lineCountsByPoId,
    variantDefaultLineNotes,
    legacyOrphanPoLines,
    customOrderCountByPoId,
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
      tableViewShopifyRows={tableViewShopifyRows}
      tableViewPoRows={tableViewPoRows}
      tableViewShopifyTotal={tableViewShopifyTotal}
      tableViewPoTotal={tableViewPoTotal}
    />
  );
}
