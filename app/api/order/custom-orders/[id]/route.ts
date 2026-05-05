import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await context.params;

    const order = await prisma.shopifyOrder.findUnique({
      where: { id },
      select: { id: true, isCustomOrder: true },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 });
    }

    if (!order.isCustomOrder) {
      return NextResponse.json(
        { ok: false, error: 'Only replacement orders can be deleted via this endpoint' },
        { status: 400 },
      );
    }

    await prisma.shopifyOrder.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'DELETE /api/order/custom-orders/[id] error:');
  }
}
