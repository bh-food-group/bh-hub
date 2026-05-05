import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { parseBody, shopifyOrdersOfficePendingPostSchema } from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';

export async function POST(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const result = await parseBody(request, shopifyOrdersOfficePendingPostSchema);
    if ('error' in result) return result.error;
    const { shopifyOrderIds, pending } = result.data;

    await prisma.shopifyOrder.updateMany({
      where: { id: { in: shopifyOrderIds } },
      data: { officePendingAt: pending ? new Date() : null },
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(
      err,
      'POST /api/shopify/orders/office-pending error:',
    );
  }
}
