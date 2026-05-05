import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { parseBody, supplierGroupBulkDeliveryScheduleSchema } from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import { parseSupplierDeliverySchedule } from '@/lib/order/supplier-delivery-schedule';
import { Prisma } from '@prisma/client';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * Sets the same `deliverySchedule` on every supplier in this group.
 * `deliverySchedule: null` clears the schedule for all members.
 */
export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id: groupId } = await ctx.params;
    const result = await parseBody(request, supplierGroupBulkDeliveryScheduleSchema);
    if ('error' in result) return result.error;

    const group = await prisma.supplierGroup.findUnique({
      where: { id: groupId },
      select: { id: true },
    });
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const { deliverySchedule } = result.data;
    const prismaValue: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      deliverySchedule === null
        ? Prisma.JsonNull
        : (parseSupplierDeliverySchedule(deliverySchedule) as Prisma.InputJsonValue);

    const updateResult = await prisma.supplier.updateMany({
      where: { groupId },
      data: { deliverySchedule: prismaValue },
    });

    return NextResponse.json({
      ok: true,
      updatedCount: updateResult.count,
    });
  } catch (err: unknown) {
    return toApiErrorResponse(
      err,
      'PATCH /api/order/supplier-groups/[id]/delivery-schedule error:',
    );
  }
}
