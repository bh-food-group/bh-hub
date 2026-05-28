import { auth } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { redirect } from 'next/navigation';
import { LocationOrderView } from '@/features/order/location/components/LocationOrderView';
import type {
  LocationOrderSupplierGroup,
  FavoriteSupplier,
  SupplierGroupNav,
} from '@/features/order/location/types';

export const dynamic = 'force-dynamic';

const LocationOrderPage = async () => {
  const session = await auth();
  if (!session?.user?.id) redirect('/auth');

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

  if (locationEmails.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        No order history found for this location.
      </div>
    );
  }

  // Load PO metadata without line items for fast initial render.
  const [purchaseOrders, rawFavorites, rawGroups] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: {
        shopifyOrders: {
          some: { email: { in: locationEmails } },
        },
      },
      orderBy: [{ dateCreated: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      select: {
        id: true,
        poNumber: true,
        status: true,
        dateCreated: true,
        expectedDate: true,
        totalPrice: true,
        comment: true,
        supplier: { select: { id: true, company: true } },
        shopifyOrders: {
          where: { email: { in: locationEmails } },
          select: { name: true, processedAt: true, shopifyCreatedAt: true },
        },
      },
    }),
    prisma.supplier.findMany({
      where: { isFavorite: true },
      select: { id: true, company: true, groupId: true },
      orderBy: { company: 'asc' },
    }),
    prisma.supplierGroup.findMany({
      select: { id: true, name: true },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);

  // Determine the 3 most recent distinct ETA dates and pre-load their line items.
  // All other POs get an empty lineItems array; they load lazily on accordion open.
  const etaDates = [
    ...new Set(
      purchaseOrders
        .filter((po) => po.expectedDate)
        .map((po) => (po.expectedDate as Date).toISOString().slice(0, 10))
        .sort()
        .reverse(),
    ),
  ].slice(0, 3);

  const etaPoIds = purchaseOrders
    .filter(
      (po) =>
        po.expectedDate &&
        etaDates.includes((po.expectedDate as Date).toISOString().slice(0, 10)),
    )
    .map((po) => po.id);

  const etaLineItemRows =
    etaPoIds.length > 0
      ? await prisma.purchaseOrderLineItem.findMany({
          where: { purchaseOrderId: { in: etaPoIds } },
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            purchaseOrderId: true,
            sequence: true,
            productTitle: true,
            variantTitle: true,
            sku: true,
            quantity: true,
            itemPrice: true,
            note: true,
          },
        })
      : [];

  const lineItemsByPoId = new Map<string, typeof etaLineItemRows>();
  for (const li of etaLineItemRows) {
    const arr = lineItemsByPoId.get(li.purchaseOrderId) ?? [];
    arr.push(li);
    lineItemsByPoId.set(li.purchaseOrderId, arr);
  }

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
      lineItems: (lineItemsByPoId.get(po.id) ?? []).map((li) => ({
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

  const favoriteSuppliers: FavoriteSupplier[] = rawFavorites.map((s) => ({
    id: s.id,
    name: s.company,
    groupId: s.groupId,
  }));

  const supplierGroupsNav: SupplierGroupNav[] = rawGroups.map((g) => ({
    id: g.id,
    name: g.name,
  }));

  return (
    <LocationOrderView
      supplierGroups={supplierGroups}
      locationName={location?.name ?? 'My Location'}
      favoriteSuppliers={favoriteSuppliers}
      supplierGroupsNav={supplierGroupsNav}
    />
  );
};

export default LocationOrderPage;
