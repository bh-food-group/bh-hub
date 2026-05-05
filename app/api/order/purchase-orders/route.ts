import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { parseBody, purchaseOrderCreateSchema } from '@/lib/api/schemas';
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

export async function GET() {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      orderBy: [{ dateCreated: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        poNumber: true,
        status: true,
        currency: true,
        isAuto: true,
        dateCreated: true,
        expectedDate: true,
        completedAt: true,
        totalPrice: true,
        supplierId: true,
        supplier: { select: { id: true, company: true } },
        _count: { select: { lineItems: true, shopifyOrders: true } },
      },
    });

    return NextResponse.json({ ok: true, purchaseOrders });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/order/purchase-orders error:');
  }
}

export async function POST(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;
    const { session } = gate;

    const result = await parseBody(request, purchaseOrderCreateSchema);
    if ('error' in result) return result.error;
    const { data } = result;

    if (data.poNumber !== 'AUTO') {
      const taken = await prisma.purchaseOrder.findUnique({
        where: { poNumber: data.poNumber },
        select: { id: true },
      });
      if (taken) {
        return NextResponse.json(
          {
            error: 'This PO number is already in use.',
            code: 'PO_NUMBER_TAKEN',
          },
          { status: 409 },
        );
      }
    }

    const lineItems = data.lineItems;
    const orderNamesFromRefs = (data.shopifyOrderRefs ?? []).map(
      (r) => r.orderNumber,
    );
    /** One resolve for validation + create (avoids duplicate queries inside the transaction). */
    const resolved = await resolvePoCreateLineShopifyLinks(
      prisma,
      orderNamesFromRefs,
      lineItems,
    );
    if (data.expectedDate && resolved.shopifyOrderIds.length > 0) {
      const ordersForMin = await prisma.shopifyOrder.findMany({
        where: { id: { in: resolved.shopifyOrderIds } },
        select: { processedAt: true, shopifyCreatedAt: true },
      });
      const minY = minExpectedDateYmdFromShopifyOrders(ordersForMin);
      if (minY && data.expectedDate < minY) {
        return NextResponse.json(
          {
            error: expectedDateBeforeOrderMessage(),
            code: EXPECTED_DATE_BEFORE_ORDER_CODE,
          },
          { status: 400 },
        );
      }
    }

    const {
      shopifyOrderIds,
      lineShopifyOrderLineItemIds,
      lineResolvedVariantGids,
    } = resolved;

    if (data.deliveryLocationPresetId) {
      const preset = await prisma.deliveryLocationPreset.findUnique({
        where: { id: data.deliveryLocationPresetId },
        select: { id: true },
      });
      if (!preset) {
        return NextResponse.json(
          { error: 'Delivery location preset not found' },
          { status: 400 },
        );
      }
    }

    const po = await prisma.$transaction(async (tx) => {
      let poNumber = data.poNumber;
      if (poNumber === 'AUTO') {
        const latest = await tx.purchaseOrder.findFirst({
          orderBy: { poNumber: 'desc' },
          select: { poNumber: true },
        });
        const lastNum = latest?.poNumber
          ? parseInt(latest.poNumber.replace(/\D/g, ''), 10) || 0
          : 0;
        poNumber = String(lastNum + 1);
      }

      const authorizedBy =
        session.user?.name?.trim() || session.user?.email?.trim() || null;

      const created = await tx.purchaseOrder.create({
        data: {
          poNumber,
          currency: data.currency,
          isAuto: data.isAuto,
          status: data.hubPending ? 'pending' : 'unfulfilled',
          dateCreated: new Date(),
          expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
          comment: data.comment ?? null,
          supplierId: data.supplierId!,
          shippingAddress: data.shippingAddress ?? undefined,
          billingAddress: data.billingAddress ?? undefined,
          billingSameAsShipping: data.billingSameAsShipping,
          deliveryLocationPresetId: data.deliveryLocationPresetId ?? null,
          authorizedBy,
          createdById: session.user.id,
        },
      });

      if (lineItems.length > 0) {
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
              purchaseOrderId: created.id,
              sequence: idx + 1,
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
      }

      if (shopifyOrderIds.length > 0) {
        await tx.purchaseOrder.update({
          where: { id: created.id },
          data: {
            shopifyOrders: {
              connect: shopifyOrderIds.map((id) => ({ id })),
            },
          },
        });
      }

      return tx.purchaseOrder.findUniqueOrThrow({
        where: { id: created.id },
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
    });

    return NextResponse.json(
      {
        ok: true,
        purchaseOrder: po,
        officeBlock: mapPrismaPoToBlock(po),
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'POST /api/order/purchase-orders error:');
  }
}
