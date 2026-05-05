import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { parseBody, supplierCreateSchema } from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import { resolveSupplierGroupId } from '@/lib/order/default-supplier-group';
import {
  assertSupplierOrderChannel,
  legacyColumnsFromOrderChannel,
} from '@/lib/order/supplier-order-channel';
import { parseSupplierDeliverySchedule } from '@/lib/order/supplier-delivery-schedule';
import { Prisma } from '@prisma/client';

export async function GET() {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const suppliers = await prisma.supplier.findMany({
      orderBy: { company: 'asc' },
      select: {
        id: true,
        company: true,
        officePoSupplierCode: true,
        shopifyVendorName: true,
        contactName: true,
        contactEmails: true,
        contactPhone: true,
        preferredCommMode: true,
        orderChannelType: true,
        orderChannelPayload: true,
        groupId: true,
        isFavorite: true,
        link: true,
        notes: true,
        createdAt: true,
        deliverySchedule: true,
        _count: { select: { purchaseOrders: true } },
      },
    });

    return NextResponse.json({ ok: true, suppliers });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/order/suppliers error:');
  }
}

export async function POST(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const result = await parseBody(request, supplierCreateSchema);
    if ('error' in result) return result.error;
    const { data } = result;

    const groupId = await resolveSupplierGroupId(prisma, data.groupId);

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

    const deliveryScheduleCreate:
      | Prisma.NullableJsonNullValueInput
      | Prisma.InputJsonValue
      | undefined =
      data.deliverySchedule === undefined
        ? undefined
        : data.deliverySchedule === null
          ? Prisma.JsonNull
          : (parseSupplierDeliverySchedule(data.deliverySchedule) as Prisma.InputJsonValue);

    const supplier = await prisma.supplier.create({
      data: {
        company: data.company,
        officePoSupplierCode: data.officePoSupplierCode?.trim() || null,
        shopifyVendorName: data.shopifyVendorName ?? null,
        groupId,
        notes: null,
        orderChannelType: data.orderChannelType,
        orderChannelPayload: channel.payload as unknown as Prisma.InputJsonValue,
        contactName: legacy.contactName,
        contactEmails: legacy.contactEmails,
        link: legacy.link,
        contactPhone: null,
        preferredCommMode: null,
        ...(deliveryScheduleCreate !== undefined && {
          deliverySchedule: deliveryScheduleCreate,
        }),
      },
    });

    // Auto-create vendor mapping for shopifyVendorName
    if (data.shopifyVendorName) {
      await prisma.shopifyVendorMapping.upsert({
        where: { vendorName: data.shopifyVendorName },
        create: {
          vendorName: data.shopifyVendorName,
          supplierId: supplier.id,
        },
        update: { supplierId: supplier.id },
      });
    }

    // Create additional vendor alias mappings
    if (data.vendorAliases && data.vendorAliases.length > 0) {
      for (const alias of data.vendorAliases) {
        await prisma.shopifyVendorMapping.upsert({
          where: { vendorName: alias },
          create: { vendorName: alias, supplierId: supplier.id },
          update: { supplierId: supplier.id },
        });
      }
    }

    return NextResponse.json({ ok: true, supplier }, { status: 201 });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'POST /api/order/suppliers error:');
  }
}
