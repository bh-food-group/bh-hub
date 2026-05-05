import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';

type RouteCtx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, ctx: RouteCtx) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    const { name } = (await request.json()) as { name?: string };
    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Group name is required' },
        { status: 400 },
      );
    }

    const group = await prisma.supplierGroup.update({
      where: { id },
      data: { name: name.trim() },
    });

    return NextResponse.json({ ok: true, group });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'PUT /api/order/supplier-groups/[id] error:');
  }
}

export async function DELETE(_request: NextRequest, ctx: RouteCtx) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;

    const count = await prisma.supplier.count({ where: { groupId: id } });
    if (count > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete: ${count} supplier(s) still assigned to this group. Reassign them first.`,
        },
        { status: 409 },
      );
    }

    await prisma.supplierGroup.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(
      err,
      'DELETE /api/order/supplier-groups/[id] error:',
    );
  }
}
