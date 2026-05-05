import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { deliveryLocationPresetPatchSchema, parseBody } from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import { syncPresetLinkedLocations } from '@/lib/delivery-location-preset/sync-preset-linked-locations';

type RouteContext = { params: Promise<{ id: string }> };

const PRESET_LOCATIONS_INCLUDE = {
  locations: {
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' as const },
  },
} as const;

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await context.params;
    const result = await parseBody(request, deliveryLocationPresetPatchSchema);
    if ('error' in result) return result.error;
    const { data } = result;

    const existing = await prisma.deliveryLocationPreset.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Preset not found' }, { status: 404 });
    }

    if (data.locationIds !== undefined) {
      const uniqueIds = [...new Set(data.locationIds)];
      if (uniqueIds.length > 0) {
        const n = await prisma.location.count({
          where: { id: { in: uniqueIds } },
        });
        if (n !== uniqueIds.length) {
          return NextResponse.json(
            { error: 'One or more location ids are invalid' },
            { status: 400 },
          );
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.deliveryLocationPreset.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.company !== undefined
            ? { company: data.company?.trim() ? data.company.trim() : null }
            : {}),
          ...(data.address1 !== undefined ? { address1: data.address1 } : {}),
          ...(data.address2 !== undefined
            ? { address2: data.address2?.trim() ? data.address2.trim() : null }
            : {}),
          ...(data.city !== undefined ? { city: data.city } : {}),
          ...(data.province !== undefined ? { province: data.province } : {}),
          ...(data.postalCode !== undefined ? { postalCode: data.postalCode } : {}),
          ...(data.country !== undefined
            ? { country: data.country?.trim() || 'CA' }
            : {}),
          ...(data.lat !== undefined ? { lat: data.lat } : {}),
          ...(data.lng !== undefined ? { lng: data.lng } : {}),
        },
      });
      if (data.locationIds !== undefined) {
        await syncPresetLinkedLocations(tx, id, data.locationIds);
      }
      return tx.deliveryLocationPreset.findUniqueOrThrow({
        where: { id },
        include: PRESET_LOCATIONS_INCLUDE,
      });
    });

    return NextResponse.json({ ok: true, preset: updated });
  } catch (err: unknown) {
    return toApiErrorResponse(
      err,
      'PATCH /api/order/delivery-location-presets/[id] error:',
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await context.params;

    const existing = await prisma.deliveryLocationPreset.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Preset not found' }, { status: 404 });
    }

    await prisma.deliveryLocationPreset.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(
      err,
      'DELETE /api/order/delivery-location-presets/[id] error:',
    );
  }
}
