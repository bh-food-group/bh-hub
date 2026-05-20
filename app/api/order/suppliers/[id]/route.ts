import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { parseBody, supplierUpdateSchema } from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import { resolveSupplierGroupId } from '@/lib/order/default-supplier-group';
import {
  assertSupplierOrderChannel,
  legacyColumnsFromOrderChannel,
} from '@/lib/order/supplier-order-channel';
import { parseSupplierDeliverySchedule } from '@/lib/order/supplier-delivery-schedule';
import { syncLocationVendorPairs, upsertVendorMapping } from '@/lib/order/vendor-mapping';
import { Prisma } from '@prisma/client';

type RouteCtx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, ctx: RouteCtx) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;
    const result = await parseBody(request, supplierUpdateSchema);
    if ('error' in result) return result.error;
    const { data } = result;

    const resolvedGroupId =
      data.groupId !== undefined
        ? await resolveSupplierGroupId(prisma, data.groupId)
        : undefined;

    let orderChannelPrisma:
      | {
          orderChannelType: string;
          orderChannelPayload: Prisma.InputJsonValue;
          contactName: string | null;
          contactEmails: string[];
          link: string | null;
        }
      | undefined;

    if (
      data.orderChannelType !== undefined &&
      data.orderChannelPayload !== undefined
    ) {
      const instruction = (data.instruction ?? data.notes ?? '')?.trim() ?? '';
      const payloadWithInstruction =
        data.orderChannelPayload && typeof data.orderChannelPayload === 'object'
          ? {
              ...(data.orderChannelPayload as Record<string, unknown>),
              instruction,
            }
          : { instruction };
      const channel = assertSupplierOrderChannel(
        data.orderChannelType,
        payloadWithInstruction,
      );
      if (!channel.ok) {
        return NextResponse.json(
          { error: 'Invalid order channel' },
          { status: 400 },
        );
      }
      const legacy = legacyColumnsFromOrderChannel(
        data.orderChannelType,
        channel.payload,
      );
      orderChannelPrisma = {
        orderChannelType: data.orderChannelType,
        orderChannelPayload: channel.payload as unknown as Prisma.InputJsonValue,
        contactName: legacy.contactName,
        contactEmails: legacy.contactEmails,
        link: legacy.link,
      };
    }

    let deliveryScheduleUpdate:
      | Prisma.NullableJsonNullValueInput
      | Prisma.InputJsonValue
      | undefined;
    if (data.deliverySchedule !== undefined) {
      deliveryScheduleUpdate =
        data.deliverySchedule === null
          ? Prisma.JsonNull
          : (parseSupplierDeliverySchedule(data.deliverySchedule) as Prisma.InputJsonValue);
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        ...(data.company !== undefined && { company: data.company }),
        ...(data.officePoSupplierCode !== undefined && {
          officePoSupplierCode: data.officePoSupplierCode?.trim() || null,
        }),
        ...(data.shopifyVendorName !== undefined && {
          shopifyVendorName: data.shopifyVendorName ?? null,
        }),
        ...(data.groupId !== undefined && { groupId: resolvedGroupId }),
        ...((data.instruction !== undefined || data.notes !== undefined) && {
          notes: null,
        }),
        ...(deliveryScheduleUpdate !== undefined && {
          deliverySchedule: deliveryScheduleUpdate,
        }),
        ...(orderChannelPrisma && {
          orderChannelType: orderChannelPrisma.orderChannelType,
          orderChannelPayload: orderChannelPrisma.orderChannelPayload,
          contactName: orderChannelPrisma.contactName,
          contactEmails: orderChannelPrisma.contactEmails,
          link: orderChannelPrisma.link,
          contactPhone: null,
          preferredCommMode: null,
        }),
      },
    });

    // Auto-create/update vendor mapping for shopifyVendorName (null-location fallback)
    if (data.shopifyVendorName !== undefined && data.shopifyVendorName) {
      await upsertVendorMapping(id, { vendorName: data.shopifyVendorName });
    }

    // Sync null-location vendor alias mappings when provided (legacy aliases)
    if (data.vendorAliases !== undefined) {
      const desiredAliases = new Set(data.vendorAliases ?? []);
      // shopifyVendorName has its own mapping — don't let alias cleanup delete it
      const activeVendorName = supplier.shopifyVendorName?.trim() || null;
      await prisma.shopifyVendorMapping.deleteMany({
        where: {
          supplierId: id,
          shopifyLocationGid: null,
          vendorName: {
            notIn: [
              ...desiredAliases,
              ...(activeVendorName ? [activeVendorName] : []),
            ],
          },
        },
      });
      for (const alias of desiredAliases) {
        await upsertVendorMapping(id, { vendorName: alias });
      }
    }

    // Sync location-specific vendor mapping pairs when provided
    if (data.locationVendorPairs !== undefined) {
      await syncLocationVendorPairs(
        id,
        (data.locationVendorPairs ?? []).filter((p) => !!p.shopifyLocationGid),
      );
    }

    return NextResponse.json({ ok: true, supplier });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'PUT /api/order/suppliers/[id] error:');
  }
}

export async function PATCH(_request: NextRequest, ctx: RouteCtx) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;

    const existing = await prisma.supplier.findUnique({
      where: { id },
      select: { isFavorite: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: { isFavorite: !existing.isFavorite },
      select: { id: true, isFavorite: true },
    });

    return NextResponse.json({ ok: true, supplier });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'PATCH /api/order/suppliers/[id] error:');
  }
}

export async function DELETE(_request: NextRequest, ctx: RouteCtx) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await ctx.params;

    const existing = await prisma.supplier.findUnique({
      where: { id },
      select: { _count: { select: { purchaseOrders: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
    }
    if (existing._count.purchaseOrders > 0) {
      return NextResponse.json(
        {
          error:
            'Cannot delete a supplier that has purchase orders. Reassign or archive those POs first.',
        },
        { status: 409 },
      );
    }

    await prisma.supplier.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'DELETE /api/order/suppliers/[id] error:');
  }
}
