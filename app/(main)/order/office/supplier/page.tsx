import { auth } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { isShopifyAdminEnvConfigured } from '@/lib/shopify/env';
import { fetchShopifyVendorsFromEnv } from '@/lib/shopify/fetchVendors';
import { SuppliersClient } from '@/features/order/office/components/SuppliersClient';
import { resolveCustomerDisplayName } from '@/lib/order/resolve-customer-display-name';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function OfficeSuppliersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/auth');

  const shopifyConfigured = isShopifyAdminEnvConfigured();
  let vendors: string[] = [];
  if (shopifyConfigured) {
    try {
      vendors = await fetchShopifyVendorsFromEnv();
    } catch (e) {
      console.error('Failed to fetch Shopify vendors:', e);
    }
  }

  const [groups, suppliers, customers, presets] = await Promise.all([
    prisma.supplierGroup.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        _count: { select: { suppliers: true } },
      },
    }),
    prisma.supplier.findMany({
      orderBy: [{ isFavorite: 'desc' }, { company: 'asc' }],
      select: {
        id: true,
        company: true,
        officePoSupplierCode: true,
        shopifyVendorName: true,
        groupId: true,
        group: { select: { name: true, slug: true } },
        contactName: true,
        contactEmails: true,
        orderChannelType: true,
        orderChannelPayload: true,
        isFavorite: true,
        link: true,
        notes: true,
        deliverySchedule: true,
        createdAt: true,
        vendorMappings: {
          select: { id: true, vendorName: true, shopifyLocationGid: true, shopifyLocationName: true },
          orderBy: { createdAt: 'asc' },
        },
        customerDeliverySchedules: {
          select: { customerId: true, schedule: true },
        },
        _count: { select: { purchaseOrders: true } },
      },
    }),
    prisma.shopifyCustomer.findMany({
      select: {
        id: true,
        displayName: true,
        displayNameOverride: true,
        company: true,
        email: true,
      },
    }),
    prisma.deliverySchedulePreset.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        windows: true,
        customerExceptions: { select: { customerId: true, windows: true } },
      },
    }),
  ]);

  const serialized = suppliers.map((s) => ({
    ...s,
    orderChannelType: s.orderChannelType ?? 'email',
    createdAt: s.createdAt.toISOString(),
  }));

  const customerOptions = customers
    .map((c) => ({ id: c.id, name: resolveCustomerDisplayName(c) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Office — Suppliers</h1>
        <p className="text-sm text-muted-foreground">
          Manage suppliers and link Shopify vendors.
        </p>
      </div>

      <SuppliersClient
        vendors={vendors}
        suppliers={serialized}
        groups={groups}
        customers={customerOptions}
        presets={presets}
        shopifyConfigured={shopifyConfigured}
      />
    </div>
  );
}
