import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { parseBody, purchaseOrderMergeInboxSchema } from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import {
  mapPrismaPoToBlock,
  prismaPoCreatedByInclude,
} from '@/features/order/office/mappers/map-purchase-order';
import { resolvePoCreateLineShopifyLinks } from '@/lib/order/resolve-po-create-line-shopify-links';
import { loadVariantOfficeNotesMap } from '@/lib/order/shopify-variant-office-note';
import {
  EXPECTED_DATE_BEFORE_ORDER_CODE,
  expectedDateBeforeOrderMessage,
  minExpectedDateYmdFromShopifyOrders,
} from '@/lib/order/min-expected-date-ymd-from-shopify-orders';
import { toVancouverYmd } from '@/features/order/office/utils/vancouver-datetime';

type RouteContext = { params: Promise<{ id: string }> };

/** Hub statuses that can still accept newly-merged inbox lines (open POs only). */
const NON_MERGEABLE_STATUSES = new Set(['fulfilled', 'completed']);

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id: purchaseOrderId } = await context.params;

    const result = await parseBody(request, purchaseOrderMergeInboxSchema);
    if ('error' in result) return result.error;
    const { data } = result;

    const target = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: { id: true, status: true, archivedAt: true, expectedDate: true },
    });
    if (!target) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 },
      );
    }
    if (target.archivedAt || NON_MERGEABLE_STATUSES.has(target.status)) {
      return NextResponse.json(
        {
          error: 'This PO can no longer accept new items.',
          code: 'PO_NOT_MERGEABLE',
        },
        { status: 409 },
      );
    }

    const lineItems = data.lineItems;
    const orderNamesFromRefs = (data.shopifyOrderRefs ?? []).map(
      (r) => r.orderNumber,
    );
    const resolved = await resolvePoCreateLineShopifyLinks(
      prisma,
      orderNamesFromRefs,
      lineItems,
    );
    const {
      shopifyOrderIds,
      lineShopifyOrderLineItemIds,
      lineResolvedVariantGids,
    } = resolved;

    // Guard: a merged order must not be placed after the PO's expected delivery date.
    if (target.expectedDate && shopifyOrderIds.length > 0) {
      const ordersForMin = await prisma.shopifyOrder.findMany({
        where: { id: { in: shopifyOrderIds } },
        select: { processedAt: true, shopifyCreatedAt: true },
      });
      const minY = minExpectedDateYmdFromShopifyOrders(ordersForMin);
      const expectedY = toVancouverYmd(target.expectedDate);
      if (minY && expectedY && expectedY < minY) {
        return NextResponse.json(
          {
            error: expectedDateBeforeOrderMessage(),
            code: EXPECTED_DATE_BEFORE_ORDER_CODE,
          },
          { status: 400 },
        );
      }
    }

    const po = await prisma.$transaction(
      async (tx) => {
        const lastLine = await tx.purchaseOrderLineItem.findFirst({
          where: { purchaseOrderId },
          orderBy: { sequence: 'desc' },
          select: { sequence: true },
        });
        const baseSeq = lastLine?.sequence ?? 0;

        const resolvedVariantGids: string[] = [];
        for (let idx = 0; idx < lineItems.length; idx++) {
          const li = lineItems[idx];
          let vg = li.shopifyVariantGid?.trim() ?? null;
          if (!vg) vg = lineResolvedVariantGids[idx]?.trim() ?? null;
          if (vg) resolvedVariantGids.push(vg);
        }
        const noteByVariant = await loadVariantOfficeNotesMap(
          tx,
          resolvedVariantGids,
        );

        await tx.purchaseOrderLineItem.createMany({
          data: lineItems.map((li, idx) => {
            let vg = li.shopifyVariantGid?.trim() ?? null;
            if (!vg) vg = lineResolvedVariantGids[idx]?.trim() ?? null;
            const defaultNote = vg ? (noteByVariant.get(vg) ?? null) : null;
            const fromClient =
              typeof li.note === 'string' ? li.note.trim() : '';
            const resolvedNote = (fromClient || defaultNote) ?? null;
            return {
              purchaseOrderId,
              sequence: baseSeq + idx + 1,
              quantity: li.quantity,
              sku: li.sku ?? null,
              variantTitle: li.variantTitle ?? null,
              productTitle: li.productTitle ?? null,
              itemPrice: li.itemPrice ?? null,
              supplierRef: li.supplierRef ?? null,
              isCustom: li.isCustom ?? false,
              shopifyVariantGid: li.shopifyVariantGid ?? null,
              shopifyProductGid: li.shopifyProductGid ?? null,
              shopifyOrderLineItemId: lineShopifyOrderLineItemIds[idx] ?? null,
              note: resolvedNote,
            };
          }),
        });

        if (shopifyOrderIds.length > 0) {
          await tx.purchaseOrder.update({
            where: { id: purchaseOrderId },
            data: {
              shopifyOrders: {
                connect: shopifyOrderIds.map((id) => ({ id })),
              },
            },
          });
        }

        return tx.purchaseOrder.findUniqueOrThrow({
          where: { id: purchaseOrderId },
          include: {
            lineItems: {
              orderBy: { sequence: 'asc' },
              include: { shopifyOrderLineItem: true },
            },
            shopifyOrders: { include: { customer: true } },
            supplier: true,
            emailDeliveries: true,
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
        });
      },
      { maxWait: 10000, timeout: 30000 },
    );

    return NextResponse.json({
      ok: true,
      purchaseOrder: po,
      officeBlock: mapPrismaPoToBlock(po),
    });
  } catch (err: unknown) {
    return toApiErrorResponse(
      err,
      'POST /api/order/purchase-orders/[id]/merge-inbox error:',
    );
  }
}
