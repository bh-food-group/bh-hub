import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';
import { createId } from '@paralleldrive/cuid2';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };

const patchOpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('setQuantity'),
    lineItemId: z.string(),
    quantity: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('removeLine'),
    lineItemId: z.string(),
  }),
  z.object({
    type: z.literal('addLine'),
    productTitle: z.string().min(1),
    quantity: z.number().int().positive(),
    sku: z.string().nullable().optional(),
    variantTitle: z.string().nullable().optional(),
    itemPrice: z.string().nullable().optional(),
    shopifyVariantGid: z.string().nullable().optional(),
    shopifyProductGid: z.string().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
  }),
]);

const patchBodySchema = z.object({
  operations: z.array(patchOpSchema).min(1),
});

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await context.params;

    const order = await prisma.shopifyOrder.findUnique({
      where: { id },
      select: { id: true, isReplacementOrder: true },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 });
    }
    if (!order.isReplacementOrder) {
      return NextResponse.json(
        { ok: false, error: 'Only replacement orders can be edited via this endpoint' },
        { status: 400 },
      );
    }

    const body = await request.json();
    const parsed = patchBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }

    const { operations } = parsed.data;

    // Infer vendor from existing lines so new lines inherit it (for supplier matching).
    let inferredVendor: string | null = null;
    if (operations.some((op) => op.type === 'addLine')) {
      const existingLine = await prisma.shopifyOrderLineItem.findFirst({
        where: { orderId: id },
        select: { vendor: true },
      });
      inferredVendor = existingLine?.vendor ?? null;
    }

    for (const op of operations) {
      if (op.type === 'setQuantity') {
        if (op.quantity <= 0) {
          await prisma.shopifyOrderLineItem.deleteMany({ where: { id: op.lineItemId, orderId: id } });
        } else {
          await prisma.shopifyOrderLineItem.updateMany({
            where: { id: op.lineItemId, orderId: id },
            data: { quantity: op.quantity },
          });
        }
      } else if (op.type === 'removeLine') {
        await prisma.shopifyOrderLineItem.deleteMany({ where: { id: op.lineItemId, orderId: id } });
      } else if (op.type === 'addLine') {
        const liId = createId();
        await prisma.shopifyOrderLineItem.create({
          data: {
            id: liId,
            shopifyGid: `custom_li::${liId}`,
            orderId: id,
            title: op.productTitle,
            sku: op.sku ?? null,
            variantTitle: op.variantTitle ?? null,
            productGid: op.shopifyProductGid ?? null,
            variantGid: op.shopifyVariantGid ?? null,
            imageUrl: op.imageUrl ?? null,
            vendor: inferredVendor,
            quantity: op.quantity,
            price: op.itemPrice ? parseFloat(op.itemPrice) : null,
          },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'PATCH /api/order/replacement-orders/[id] error:');
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await context.params;

    const order = await prisma.shopifyOrder.findUnique({
      where: { id },
      select: { id: true, isReplacementOrder: true },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 });
    }

    if (!order.isReplacementOrder) {
      return NextResponse.json(
        { ok: false, error: 'Only replacement orders can be deleted via this endpoint' },
        { status: 400 },
      );
    }

    await prisma.shopifyOrder.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'DELETE /api/order/replacement-orders/[id] error:');
  }
}
