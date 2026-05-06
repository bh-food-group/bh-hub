import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';
import { z } from 'zod';
import { createRefundRecords } from '@/lib/order/create-refund';

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
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate + 'T23:59:59Z') } : {}),
      };
    }

    const [records, total] = await Promise.all([
      prisma.refundReplacementRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          purchaseOrder: { select: { poNumber: true } },
          createdBy: { select: { name: true, email: true } },
        },
      }),
      prisma.refundReplacementRecord.count({ where }),
    ]);

    return NextResponse.json({ records, total });
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
  reasonSubcategory: z.string().min(1),
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
