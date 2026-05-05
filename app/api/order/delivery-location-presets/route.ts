import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import {
  deliveryLocationPresetCreateSchema,
  parseBody,
} from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import { syncPresetLinkedLocations } from '@/lib/delivery-location-preset/sync-preset-linked-locations';

const PRESET_LOCATIONS_INCLUDE = {
  locations: {
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' as const },
  },
} as const;

export async function GET(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') ?? '').trim();
    const locationId = (searchParams.get('locationId') ?? '').trim();

    const where: Prisma.DeliveryLocationPresetWhereInput = {};
    if (locationId) {
      where.locations = { some: { id: locationId } };
    }
    if (q.length > 0) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { address1: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        {
          locations: {
            some: {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { code: { contains: q, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    const presets = await prisma.deliveryLocationPreset.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 200,
      include: PRESET_LOCATIONS_INCLUDE,
    });

    return NextResponse.json({ ok: true, presets });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/order/delivery-location-presets error:');
  }
}

export async function POST(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const result = await parseBody(request, deliveryLocationPresetCreateSchema);
    if ('error' in result) return result.error;
    const { data } = result;

    const locationIds = data.locationIds ?? [];
    const uniqueIds = [...new Set(locationIds)];
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

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.deliveryLocationPreset.create({
        data: {
          name: data.name,
          company: data.company?.trim() ? data.company.trim() : null,
          address1: data.address1,
          address2: data.address2?.trim() ? data.address2.trim() : null,
          city: data.city,
          province: data.province,
          postalCode: data.postalCode,
          country: data.country?.trim() || 'CA',
          lat: data.lat ?? null,
          lng: data.lng ?? null,
        },
      });
      await syncPresetLinkedLocations(tx, row.id, uniqueIds);
      return tx.deliveryLocationPreset.findUniqueOrThrow({
        where: { id: row.id },
        include: PRESET_LOCATIONS_INCLUDE,
      });
    });

    return NextResponse.json({ ok: true, preset: created }, { status: 201 });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'POST /api/order/delivery-location-presets error:');
  }
}
