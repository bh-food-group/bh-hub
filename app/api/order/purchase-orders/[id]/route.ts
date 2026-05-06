import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { parseBody, purchaseOrderUpdateSchema } from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import { recomputePurchaseOrderStatusById } from '@/lib/order/purchase-order-status';
import {
  mapPrismaPoToBlock,
  prismaPoCreatedByInclude,
} from '@/features/order/office/mappers/map-purchase-order';
import {
  EXPECTED_DATE_BEFORE_ORDER_CODE,
  expectedDateBeforeOrderMessage,
  minExpectedDateYmdFromShopifyOrders,
} from '@/lib/order/min-expected-date-ymd-from-shopify-orders';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await context.params;
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        lineItems: {
          orderBy: { sequence: 'asc' },
          include: { shopifyOrderLineItem: true },
        },
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
    });

    if (!po) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 },
      );
    }

    // For line items without a linked ShopifyOrderLineItem (e.g. legacy imported POs),
    // fall back to imageUrl via variantGid so images still render.
    const unlinkedVariantGids = po.lineItems
      .filter((li) => !li.shopifyOrderLineItem && li.shopifyVariantGid)
      .map((li) => li.shopifyVariantGid!);

    const variantImageFallback = new Map<string, string | null>();
    if (unlinkedVariantGids.length > 0) {
      const rows = await prisma.shopifyOrderLineItem.findMany({
        where: { variantGid: { in: unlinkedVariantGids }, imageUrl: { not: null } },
        select: { variantGid: true, imageUrl: true },
        distinct: ['variantGid'],
      });
      for (const r of rows) {
        if (r.variantGid) variantImageFallback.set(r.variantGid, r.imageUrl);
      }
    }

    const replacementOrderCount = await prisma.shopifyOrder.count({
      where: { sourcePurchaseOrderId: id, isReplacementOrder: true, archivedAt: null },
    });

    return NextResponse.json({ ok: true, officeBlock: mapPrismaPoToBlock(po, variantImageFallback, replacementOrderCount) });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/order/purchase-orders/[id] error:');
  }
}

export async function PUT(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await context.params;
    const result = await parseBody(request, purchaseOrderUpdateSchema);
    if ('error' in result) return result.error;
    const { data } = result;

    const existing = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 },
      );
    }

    if (data.expectedDate) {
      const linkedOrders = await prisma.shopifyOrder.findMany({
        where: { purchaseOrders: { some: { id } } },
        select: { processedAt: true, shopifyCreatedAt: true },
      });
      const minY = minExpectedDateYmdFromShopifyOrders(linkedOrders);
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

    if (data.poNumber !== undefined) {
      const taken = await prisma.purchaseOrder.findFirst({
        where: { poNumber: data.poNumber, NOT: { id } },
        select: { id: true },
      });
      if (taken) {
        return NextResponse.json(
          { error: 'This PO number is already in use.', code: 'PO_NUMBER_TAKEN' },
          { status: 409 },
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (data.poNumber !== undefined) updateData.poNumber = data.poNumber;
    if (data.supplierId !== undefined) updateData.supplierId = data.supplierId;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.comment !== undefined) updateData.comment = data.comment;
    if (data.expectedDate !== undefined) {
      updateData.expectedDate = data.expectedDate
        ? new Date(data.expectedDate)
        : null;
    }
    if (data.completedAt !== undefined) {
      updateData.completedAt = data.completedAt
        ? new Date(data.completedAt)
        : null;
    }
    if (data.emailDeliveryWaived !== undefined) {
      updateData.emailDeliveryWaivedAt = data.emailDeliveryWaived
        ? new Date()
        : null;
    }
    if (data.shippingAddress !== undefined) {
      updateData.shippingAddress = data.shippingAddress ?? null;
    }
    if (data.billingAddress !== undefined) {
      updateData.billingAddress = data.billingAddress ?? null;
    }
    if (data.billingSameAsShipping !== undefined) {
      updateData.billingSameAsShipping = data.billingSameAsShipping;
    }
    if (data.deliveryLocationPresetId !== undefined) {
      updateData.deliveryLocationPresetId = data.deliveryLocationPresetId;
    }
    if (data.status !== undefined) {
      updateData.status = data.status;
    }

    await prisma.purchaseOrder.update({
      where: { id },
      data: updateData,
    });

    await recomputePurchaseOrderStatusById(id);

    const po = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: {
        lineItems: { orderBy: { sequence: 'asc' } },
        shopifyOrders: true,
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
    });

    return NextResponse.json({ ok: true, purchaseOrder: po });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'PUT /api/order/purchase-orders/[id] error:');
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await context.params;

    const existing = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 },
      );
    }

    await prisma.purchaseOrder.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'DELETE /api/order/purchase-orders/[id] error:');
  }
}
