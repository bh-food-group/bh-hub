import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { parseBody, deliveryPresetCreateSchema } from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import { parseIsoWeekWindows } from '@/lib/order/supplier-delivery-schedule';
import { Prisma } from '@prisma/client';

export async function GET() {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const presets = await prisma.deliverySchedulePreset.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        windows: true,
        sortOrder: true,
        customerExceptions: {
          select: { customerId: true, windows: true },
        },
      },
    });

    return NextResponse.json({ ok: true, presets });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/order/delivery-presets error:');
  }
}

export async function POST(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const result = await parseBody(request, deliveryPresetCreateSchema);
    if ('error' in result) return result.error;
    const { data } = result;

    const windows = parseIsoWeekWindows(data.windows);
    if (!windows) {
      return NextResponse.json({ error: 'Invalid partition windows' }, { status: 400 });
    }

    const maxOrder = await prisma.deliverySchedulePreset.aggregate({
      _max: { sortOrder: true },
    });

    const preset = await prisma.deliverySchedulePreset.create({
      data: {
        name: data.name,
        windows: windows as unknown as Prisma.InputJsonValue,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
      select: { id: true, name: true, windows: true, sortOrder: true },
    });

    return NextResponse.json({ ok: true, preset }, { status: 201 });
  } catch (err: unknown) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err as Prisma.PrismaClientKnownRequestError).code === 'P2002'
    ) {
      return NextResponse.json(
        { error: 'A preset with this name already exists' },
        { status: 409 },
      );
    }
    return toApiErrorResponse(err, 'POST /api/order/delivery-presets error:');
  }
}
