import { auth } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { redirect, notFound } from 'next/navigation';
import { EtaDetailView } from '@/features/order/location/components/EtaDetailView';
import type { LocationOrderSupplierGroup } from '@/features/order/location/types';

export const dynamic = 'force-dynamic';

const EtaDetailPage = async ({ params }: { params: Promise<{ date: string }> }) => {
  const session = await auth();
  if (!session?.user?.id) redirect('/auth');

  const { date } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return notFound();

  const locationId = session.user.locationId;

  const location = locationId
    ? await prisma.location.findUnique({
        where: { id: locationId },
        select: {
          id: true,
          name: true,
          users: { select: { email: true } },
        },
      })
    : null;

  const locationEmails = (location?.users ?? [])
    .map((u) => u.email)
    .filter((e): e is string => !!e);

  if (locationEmails.length === 0) return notFound();

  const startOfDay = new Date(`${date}T00:00:00.000Z`);
  const startOfNextDay = new Date(startOfDay);
  startOfNextDay.setUTCDate(startOfNextDay.getUTCDate() + 1);

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      shopifyOrders: { some: { email: { in: locationEmails } } },
      expectedDate: { gte: startOfDay, lt: startOfNextDay },
    },
    orderBy: [{ dateCreated: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      poNumber: true,
      status: true,
      dateCreated: true,
      expectedDate: true,
      totalPrice: true,
      comment: true,
      supplier: { select: { id: true, company: true } },
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
      shopifyOrders: {
        where: { email: { in: locationEmails } },
        select: { name: true, processedAt: true, shopifyCreatedAt: true },
      },
    },
  });

  const groupMap = new Map<string, LocationOrderSupplierGroup>();

  for (const po of purchaseOrders) {
    const key = po.supplier?.id ?? '__unknown__';
    const supplierName = po.supplier?.company ?? 'Unknown Supplier';

    if (!groupMap.has(key)) {
      groupMap.set(key, { supplierId: po.supplier?.id ?? null, supplierName, purchaseOrders: [] });
    }

    groupMap.get(key)!.purchaseOrders.push({
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,
      dateCreated: po.dateCreated?.toISOString() ?? null,
      expectedDate: po.expectedDate?.toISOString() ?? null,
      totalPrice: po.totalPrice?.toString() ?? null,
      comment: po.comment ?? null,
      lineItems: po.lineItems.map((li) => ({
        id: li.id,
        sequence: li.sequence,
        productTitle: li.productTitle,
        variantTitle: li.variantTitle,
        sku: li.sku,
        quantity: li.quantity,
        itemPrice: li.itemPrice?.toString() ?? null,
        note: li.note ?? null,
      })),
      orderedAt: (() => {
        const dates = po.shopifyOrders
          .map((o) => o.processedAt ?? o.shopifyCreatedAt)
          .filter((d): d is Date => d != null);
        if (dates.length === 0) return null;
        return new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString();
      })(),
      shopifyOrderNames: po.shopifyOrders.map((o) => o.name),
    });
  }

  const supplierGroups = Array.from(groupMap.values()).sort((a, b) =>
    a.supplierName.localeCompare(b.supplierName),
  );

  return (
    <EtaDetailView
      date={date}
      locationName={location?.name ?? 'My Location'}
      supplierGroups={supplierGroups}
    />
  );
};

export default EtaDetailPage;
