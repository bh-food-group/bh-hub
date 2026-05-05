import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';

type RouteContext = { params: Promise<{ id: string }> };

/** PATCH: set emailReplyReceivedAt to now. DELETE: clear it. */
export async function PATCH(_request: NextRequest, context: RouteContext) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;
    const { id } = await context.params;
    const po = await prisma.purchaseOrder.update({
      where: { id },
      data: { emailReplyReceivedAt: new Date() },
      select: { id: true, emailReplyReceivedAt: true },
    });
    return NextResponse.json({ ok: true, emailReplyReceivedAt: po.emailReplyReceivedAt?.toISOString() ?? null });
  } catch (err) {
    return toApiErrorResponse(err, 'PATCH /api/order/purchase-orders/[id]/reply-received error:');
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;
    const { id } = await context.params;
    await prisma.purchaseOrder.update({
      where: { id },
      data: { emailReplyReceivedAt: null },
    });
    return NextResponse.json({ ok: true, emailReplyReceivedAt: null });
  } catch (err) {
    return toApiErrorResponse(err, 'DELETE /api/order/purchase-orders/[id]/reply-received error:');
  }
}
