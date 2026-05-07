import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';
import { z } from 'zod';
import { createRefundRecords } from '@/lib/order/create-refund';
import { resolveCustomerDisplayName } from '@/lib/order/resolve-customer-display-name';

// GET /api/order/refund-replacements
export async function GET(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') ?? undefined;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = {};
    if (type && type !== 'all') where.type = type;

    const expectedDateFilter: Record<string, Date> = {};
    if (startDate) expectedDateFilter.gte = new Date(startDate);
    if (endDate) expectedDateFilter.lte = new Date(endDate);
    if (Object.keys(expectedDateFilter).length > 0) {
      where.purchaseOrder = { expectedDate: expectedDateFilter };
    }

    const poDateWhere = Object.keys(expectedDateFilter).length > 0
      ? { expectedDate: expectedDateFilter }
      : {};

    const [records, total, totalQtyResult] = await Promise.all([
      prisma.refundReplacementRecord.findMany({
        where,
        orderBy: { purchaseOrder: { expectedDate: 'desc' } },
        take: limit,
        skip: offset,
        include: {
          purchaseOrder: {
            select: {
              poNumber: true,
              expectedDate: true,
              supplier: { select: { company: true } },
            },
          },
          createdBy: { select: { name: true, email: true } },
        },
      }),
      prisma.refundReplacementRecord.count({ where }),
      prisma.purchaseOrderLineItem.aggregate({
        _sum: { quantity: true },
        where: { purchaseOrder: poDateWhere },
      }),
    ]);

    const totalOrderedQty = totalQtyResult._sum.quantity ?? 0;

    // Enrich: new delivery date for replacements
    const replacementOrderIds = records
      .map((r) => r.replacementOrderId)
      .filter((id): id is string => id != null);

    const replacementDateMap: Record<string, string | null> = {};
    if (replacementOrderIds.length > 0) {
      const shopifyOrders = await prisma.shopifyOrder.findMany({
        where: { id: { in: replacementOrderIds } },
        select: {
          id: true,
          purchaseOrders: { select: { expectedDate: true }, orderBy: { createdAt: 'asc' }, take: 1 },
        },
      });
      for (const so of shopifyOrders) {
        replacementDateMap[so.id] = so.purchaseOrders[0]?.expectedDate?.toISOString() ?? null;
      }
    }

    // Enrich: customer name via shopifyOrderId (refunds) or replacementOrderId (replacements fallback)
    const orderIdsForCustomer = [
      ...records.map((r) => r.shopifyOrderId),
      ...records.map((r) => r.replacementOrderId),
    ].filter((id): id is string => id != null);

    const customerMap: Record<string, string> = {};
    if (orderIdsForCustomer.length > 0) {
      const shopifyOrders = await prisma.shopifyOrder.findMany({
        where: { id: { in: [...new Set(orderIdsForCustomer)] } },
        select: {
          id: true,
          customer: { select: { displayName: true, displayNameOverride: true, email: true, company: true } },
        },
      });
      for (const so of shopifyOrders) {
        customerMap[so.id] = resolveCustomerDisplayName(so.customer);
      }
    }

    const enriched = records.map((r) => ({
      ...r,
      newDeliveryDate: r.replacementOrderId ? (replacementDateMap[r.replacementOrderId] ?? null) : null,
      customerName:
        (r.shopifyOrderId ? customerMap[r.shopifyOrderId] : null) ??
        (r.replacementOrderId ? customerMap[r.replacementOrderId] : null) ??
        null,
    }));

    return NextResponse.json({ records: enriched, total, totalOrderedQty });
  } catch (err) {
    return toApiErrorResponse(err, 'GET /api/order/refund-replacements error:');
  }
}

const refundLineItemSchema = z.object({
  purchaseOrderLineItemId: z.string().nullable().optional(),
  shopifyOrderId: z.string().min(1),
  shopifyLineItemGid: z.string().min(1),
  productTitle: z.string().min(1),
  variantTitle: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nullable().optional(),
});

const createRefundSchema = z.object({
  purchaseOrderId: z.string().min(1),
  lineItems: z.array(refundLineItemSchema).min(1),
  reasonCategory: z.string().min(1),
  reasonSubcategory: z.string().optional().default(''),
  reasonNotes: z.string().nullable().optional(),
});

// POST /api/order/refund-replacements
export async function POST(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const body = await request.json();
    const parsed = createRefundSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }

    const { purchaseOrderId, lineItems, reasonCategory, reasonSubcategory, reasonNotes } = parsed.data;

    const records = await createRefundRecords({
      purchaseOrderId,
      lineItems,
      reasonCategory,
      reasonSubcategory,
      reasonNotes: reasonNotes ?? null,
      createdById: gate.session.user.id,
    });

    return NextResponse.json({ ok: true, records }, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err, 'POST /api/order/refund-replacements error:');
  }
}
