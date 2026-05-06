import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  reasonCategory: z.string().min(1).optional(),
  reasonSubcategory: z.string().min(1).optional(),
  reasonNotes: z.string().nullable().optional(),
});

// PATCH /api/order/refund-replacements/[id]
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await context.params;
    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }

    const record = await prisma.refundReplacementRecord.update({
      where: { id },
      data: parsed.data,
    });

    return NextResponse.json({ ok: true, record });
  } catch (err) {
    return toApiErrorResponse(err, 'PATCH /api/order/refund-replacements/[id] error:');
  }
}
