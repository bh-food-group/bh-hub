import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';

export async function POST(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { name } = (await request.json()) as { name?: string };
    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Group name is required' },
        { status: 400 },
      );
    }

    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const maxOrder = await prisma.supplierGroup.aggregate({
      _max: { sortOrder: true },
    });

    const group = await prisma.supplierGroup.create({
      data: {
        name: name.trim(),
        slug,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });

    return NextResponse.json({ ok: true, group }, { status: 201 });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'POST /api/order/supplier-groups error:');
  }
}
