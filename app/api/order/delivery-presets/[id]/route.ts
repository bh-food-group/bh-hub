import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { parseBody, deliveryPresetUpdateSchema } from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import { parseIsoWeekWindows } from '@/lib/order/supplier-delivery-schedule';
import { Prisma } from '@prisma/client';

type RouteCtx = { params: Promise<{ id: string }> };

/** Count suppliers + per-customer overrides whose schedule references this preset id. */
async function countPresetReferences(presetId: string): Promise<number> {
  const [supplierRefs, overrideRefs] = await Promise.all([
    prisma.supplier.count({
      where: { deliverySchedule: { path: ['rule', 'presetId'], equals: presetId } },
    }),
    prisma.supplierCustomerDeliverySchedule.count({
      where: { schedule: { path: ['rule', 'presetId'], equals: presetId } },
    }),
  ]);
  return supplierRefs + overrideRefs;
}

export async function PUT(request: NextRequest, ctx: RouteCtx) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    const result = await parseBody(request, deliveryPresetUpdateSchema);
    if ('error' in result) return result.error;
    const { data } = result;

    let windowsUpdate: Prisma.InputJsonValue | undefined;
    if (data.windows !== undefined) {
      const w = parseIsoWeekWindows(data.windows);
      if (!w) {
        return NextResponse.json({ error: 'Invalid partition windows' }, { status: 400 });
      }
      windowsUpdate = w as unknown as Prisma.InputJsonValue;
    }

    // Validate exception windows up front so a bad row fails the whole request.
    let exceptionRows:
      | { customerId: string; windows: Prisma.InputJsonValue }[]
      | undefined;
    if (data.customerExceptions !== undefined) {
      exceptionRows = [];
      for (const ex of data.customerExceptions) {
        const w = parseIsoWeekWindows(ex.windows);
        if (!w) {
          return NextResponse.json(
            { error: `Invalid exception windows for customer ${ex.customerId}` },
            { status: 400 },
          );
        }
        exceptionRows.push({
          customerId: ex.customerId,
          windows: w as unknown as Prisma.InputJsonValue,
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.deliverySchedulePreset.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(windowsUpdate !== undefined && { windows: windowsUpdate }),
        },
      });

      if (exceptionRows !== undefined) {
        const keepCustomerIds = exceptionRows.map((r) => r.customerId);
        await tx.deliverySchedulePresetCustomerException.deleteMany({
          where: { presetId: id, customerId: { notIn: keepCustomerIds } },
        });
        for (const row of exceptionRows) {
          await tx.deliverySchedulePresetCustomerException.upsert({
            where: { presetId_customerId: { presetId: id, customerId: row.customerId } },
            create: { presetId: id, customerId: row.customerId, windows: row.windows },
            update: { windows: row.windows },
          });
        }
      }
    });

    return NextResponse.json({ ok: true });
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
    return toApiErrorResponse(err, 'PUT /api/order/delivery-presets/[id] error:');
  }
}

export async function DELETE(_request: NextRequest, ctx: RouteCtx) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;

    const refs = await countPresetReferences(id);
    if (refs > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete: ${refs} supplier schedule(s) still use this preset. Switch them to another schedule first.`,
        },
        { status: 409 },
      );
    }

    await prisma.deliverySchedulePreset.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'DELETE /api/order/delivery-presets/[id] error:');
  }
}
