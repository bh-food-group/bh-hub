'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import type { LocationOrderLineItem } from './types';

export async function getPoLineItems(poId: string): Promise<LocationOrderLineItem[]> {
  const session = await auth();
  const locationId = session?.user?.locationId;
  if (!locationId) return [];

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { orderEmail: true },
  });

  // Scope to the location's representative order email (matches the order list/ETA pages).
  const orderEmail = location?.orderEmail ?? null;
  if (!orderEmail) return [];

  const po = await prisma.purchaseOrder.findFirst({
    where: {
      id: poId,
      shopifyOrders: { some: { email: orderEmail } },
    },
    select: {
      lineItems: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          productTitle: true,
          variantTitle: true,
          sku: true,
          quantity: true,
          itemPrice: true,
          note: true,
        },
      },
    },
  });

  if (!po) return [];

  return po.lineItems.map((li) => ({
    id: li.id,
    sequence: li.sequence,
    productTitle: li.productTitle,
    variantTitle: li.variantTitle,
    sku: li.sku,
    quantity: li.quantity,
    itemPrice: li.itemPrice?.toString() ?? null,
    note: li.note ?? null,
  }));
}
