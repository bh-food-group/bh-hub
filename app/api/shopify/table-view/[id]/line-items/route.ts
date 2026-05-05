import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';
import { customerLabelForOfficeTable } from '@/lib/order/office-table-view-fetch';
import type { OfficeShopifyTableLineItem } from '@/features/order/office/types/office-table-view';

type RouteContext = { params: Promise<{ id: string }> };

function dec(d: Prisma.Decimal | null | undefined): string | null {
  if (d == null) return null;
  return typeof d === 'object' && 'toFixed' in d
    ? (d as Prisma.Decimal).toFixed(2)
    : String(d);
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id: orderId } = await context.params;

    const order = await prisma.shopifyOrder.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        name: true,
        currencyCode: true,
        customer: {
          select: {
            displayName: true,
            displayNameOverride: true,
            company: true,
            email: true,
          },
        },
        lineItems: {
          orderBy: { id: 'asc' },
          select: {
            title: true,
            variantTitle: true,
            sku: true,
            productGid: true,
            variantGid: true,
            vendor: true,
            quantity: true,
            price: true,
            imageUrl: true,
            purchaseOrderLineItems: {
              select: {
                shopifyProductGid: true,
              },
              take: 1,
            },
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const vendors = [
      ...new Set(
        order.lineItems
          .map((l) => l.vendor?.trim())
          .filter((v): v is string => Boolean(v)),
      ),
    ];

    const vendorToCompany = new Map<string, string>();
    if (vendors.length > 0) {
      const mappings = await prisma.shopifyVendorMapping.findMany({
        where: {
          OR: vendors.map((name) => ({
            vendorName: { equals: name, mode: 'insensitive' as const },
          })),
        },
        select: { vendorName: true, supplier: { select: { company: true } } },
      });
      for (const m of mappings) {
        vendorToCompany.set(m.vendorName.toLowerCase(), m.supplier.company);
      }
    }

    const lines: OfficeShopifyTableLineItem[] = order.lineItems.map((l) => {
      const v = l.vendor?.trim() || null;
      const supplierCompany =
        v && vendorToCompany.has(v.toLowerCase())
          ? vendorToCompany.get(v.toLowerCase())!
          : null;
      return {
        title: l.title,
        variantTitle: l.variantTitle,
        sku: l.sku,
        quantity: l.quantity,
        price: dec(l.price),
        imageUrl: l.imageUrl?.trim() || null,
        shopifyProductGid:
          l.productGid?.trim() ||
          l.purchaseOrderLineItems[0]?.shopifyProductGid?.trim() ||
          null,
        shopifyVariantGid: l.variantGid?.trim() || null,
        shopifyVendor: v,
        supplierCompany,
      };
    });

    return NextResponse.json({
      ok: true,
      orderLabel: order.name,
      customerLabel: customerLabelForOfficeTable(order.customer),
      currencyCode: order.currencyCode?.trim() || 'USD',
      lines,
    });
  } catch (err: unknown) {
    return toApiErrorResponse(
      err,
      'GET /api/shopify/table-view/[id]/line-items',
    );
  }
}
