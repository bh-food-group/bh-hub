import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';
import { createId } from '@paralleldrive/cuid2';
import { z } from 'zod';

const customOrderLineItemSchema = z.object({
  sku: z.string().nullable().optional(),
  productTitle: z.string().min(1),
  variantTitle: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
  itemPrice: z.string().nullable().optional(),
  shopifyVariantGid: z.string().nullable().optional(),
  shopifyProductGid: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  /** PO line item this was created from — used to show replacement qty on the original PO line. */
  sourcePurchaseOrderLineItemId: z.string().nullable().optional(),
});

const createCustomOrderSchema = z.object({
  sourcePurchaseOrderId: z.string().min(1),
  lineItems: z.array(customOrderLineItemSchema).min(1),
});

function generateReplacementOrderName(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `#RE${digits}`;
}

export async function POST(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const body = await request.json();
    const parsed = createCustomOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { sourcePurchaseOrderId, lineItems } = parsed.data;

    const sourcePo = await prisma.purchaseOrder.findUnique({
      where: { id: sourcePurchaseOrderId },
      include: {
        supplier: { select: { shopifyVendorName: true, company: true } },
        shopifyOrders: {
          select: {
            id: true,
            name: true,
            customerId: true,
            shippingAddress: true,
            billingAddress: true,
          },
        },
      },
    });

    if (!sourcePo) {
      return NextResponse.json({ ok: false, error: 'Source PO not found' }, { status: 404 });
    }

    const referenceOrderNames =
      sourcePo.shopifyOrders.length > 0
        ? sourcePo.shopifyOrders.map((o) => o.name).join(', ')
        : null;

    const sourceOrder = sourcePo.shopifyOrders.find((o) => o.customerId) ?? sourcePo.shopifyOrders[0];
    const customerId = sourceOrder?.customerId ?? null;

    // Prefer the address from the source order; fall back to customer record defaults.
    let shippingAddress = sourceOrder?.shippingAddress ?? null;
    let billingAddress = sourceOrder?.billingAddress ?? null;
    if ((!shippingAddress || !billingAddress) && customerId) {
      const customer = await prisma.shopifyCustomer.findUnique({
        where: { id: customerId },
        select: { shippingAddress: true, billingAddress: true },
      });
      shippingAddress ??= customer?.shippingAddress ?? null;
      billingAddress ??= customer?.billingAddress ?? null;
    }

    // Use supplier's Shopify vendor name so inbox can match back to the supplier.
    // Fall back to company name when shopifyVendorName is not set.
    const supplierVendor =
      sourcePo.supplier.shopifyVendorName ?? sourcePo.supplier.company ?? null;

    const customOrderId = createId();
    const now = new Date();

    const customOrder = await prisma.shopifyOrder.create({
      data: {
        id: customOrderId,
        shopifyGid: `custom::${customOrderId}`,
        name: generateReplacementOrderName(),
        orderNumber: 0,
        isCustomOrder: true,
        referenceOrderNames,
        sourcePurchaseOrderId,
        customerId,
        syncedAt: now,
        shopifyCreatedAt: now,
        processedAt: now,
        shippingAddress: shippingAddress ?? undefined,
        billingAddress: billingAddress ?? undefined,
        lineItems: {
          create: lineItems.map((li) => {
            const liId = createId();
            return {
              id: liId,
              shopifyGid: `custom_li::${liId}`,
              title: li.productTitle,
              sku: li.sku ?? null,
              variantTitle: li.variantTitle ?? null,
              productGid: li.shopifyProductGid ?? null,
              variantGid: li.shopifyVariantGid ?? null,
              imageUrl: li.imageUrl ?? null,
              vendor: li.vendor ?? supplierVendor,
              quantity: li.quantity,
              price: li.itemPrice ? parseFloat(li.itemPrice) : null,
              sourcePurchaseOrderLineItemId: li.sourcePurchaseOrderLineItemId ?? null,
            };
          }),
        },
      },
      include: {
        lineItems: true,
        customer: true,
      },
    });

    return NextResponse.json({ ok: true, customOrder }, { status: 201 });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'POST /api/order/custom-orders error:');
  }
}
