import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';
import { z } from 'zod';
import { DEFAULT_REASON_OPTIONS } from '@/features/order/office/components/ReasonSelector';

const subcategorySchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});

const categorySchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  subs: z.array(subcategorySchema),
});

const putBodySchema = z.object({
  options: z.array(categorySchema).min(1),
});

// GET /api/order/reason-options
export async function GET() {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const row = await prisma.refundReasonOptions.findFirst();
    const options = row ? (row.data as unknown) : DEFAULT_REASON_OPTIONS;

    return NextResponse.json({ options });
  } catch (err) {
    return toApiErrorResponse(err, 'GET /api/order/reason-options error:');
  }
}

// PUT /api/order/reason-options
export async function PUT(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const body = await request.json();
    const parsed = putBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }

    const existing = await prisma.refundReasonOptions.findFirst();
    const options = parsed.data.options;

    if (existing) {
      await prisma.refundReasonOptions.update({
        where: { id: existing.id },
        data: { data: options },
      });
    } else {
      await prisma.refundReasonOptions.create({ data: { data: options } });
    }

    return NextResponse.json({ ok: true, options });
  } catch (err) {
    return toApiErrorResponse(err, 'PUT /api/order/reason-options error:');
  }
}
