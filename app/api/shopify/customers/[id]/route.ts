import { NextRequest, NextResponse } from 'next/server';
import { createAdminApiClient } from '@shopify/admin-api-client';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';
import { getShopifyAdminEnv, isShopifyAdminEnvConfigured } from '@/lib/shopify/env';

type RouteContext = { params: Promise<{ id: string }> };

type AddressJson = {
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
};

const CUSTOMER_QUERY = `query customer($id: ID!) {
  customer(id: $id) {
    defaultAddress { id }
  }
}`;

const CUSTOMER_UPDATE_MUTATION = `mutation customerUpdate($input: CustomerInput!) {
  customerUpdate(input: $input) {
    customer { id }
    userErrors { field message }
  }
}`;

function buildShopifyClient() {
  const creds = getShopifyAdminEnv();
  return createAdminApiClient({
    storeDomain: creds.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    apiVersion: creds.apiVersion,
    accessToken: creds.accessToken,
  });
}

async function pushCustomerToShopify(
  shopifyGid: string,
  opts: { company?: string | null; shippingAddress?: AddressJson | null },
) {
  if (!isShopifyAdminEnvConfigured()) return;
  const client = buildShopifyClient();

  const queryRes = await client.request(CUSTOMER_QUERY, {
    variables: { id: shopifyGid },
  });
  const addressId = (queryRes.data as { customer?: { defaultAddress?: { id: string } } })
    ?.customer?.defaultAddress?.id;

  if (!addressId) {
    console.warn('Shopify customer has no default address, skipping sync');
    return;
  }

  const addrUpdate: Record<string, string> = { id: addressId };
  if (opts.company !== undefined) {
    addrUpdate.company = opts.company ?? '';
  }
  if (opts.shippingAddress) {
    const a = opts.shippingAddress;
    if (a.address1 !== undefined) addrUpdate.address1 = a.address1;
    if (a.address2 !== undefined) addrUpdate.address2 = a.address2;
    if (a.city !== undefined) addrUpdate.city = a.city;
    if (a.province !== undefined) addrUpdate.province = a.province;
    if (a.postalCode !== undefined) addrUpdate.zip = a.postalCode;
    if (a.country !== undefined) addrUpdate.country = a.country;
  }

  const res = await client.request(CUSTOMER_UPDATE_MUTATION, {
    variables: {
      input: {
        id: shopifyGid,
        addresses: [addrUpdate],
      },
    },
  });

  const errors = (res.data as { customerUpdate?: { userErrors?: { field: string; message: string }[] } })
    ?.customerUpdate?.userErrors;
  if (errors?.length) {
    console.error('Shopify customerUpdate errors:', errors);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const { id } = await context.params;
    const body = await request.json();

    const data: Record<string, unknown> = {};

    if (typeof body.displayNameOverride === 'string') {
      data.displayNameOverride = body.displayNameOverride.trim() || null;
    }

    if (typeof body.officePoAccountCode === 'string') {
      data.officePoAccountCode = body.officePoAccountCode.trim() || null;
    }

    const companyChanged = typeof body.company === 'string';
    if (companyChanged) {
      data.company = body.company.trim() || null;
    }

    if (body.shippingAddress !== undefined) {
      data.shippingAddress = body.shippingAddress;
    }
    if (body.billingAddress !== undefined) {
      data.billingAddress = body.billingAddress;
    }
    if (typeof body.billingSameAsShipping === 'boolean') {
      data.billingSameAsShipping = body.billingSameAsShipping;
    }

    const customer = await prisma.shopifyCustomer.update({
      where: { id },
      data,
      select: {
        id: true,
        shopifyGid: true,
        displayName: true,
        displayNameOverride: true,
        email: true,
        company: true,
        officePoAccountCode: true,
        shippingAddress: true,
        billingAddress: true,
        billingSameAsShipping: true,
      },
    });

    const addressChanged = body.shippingAddress !== undefined;
    if (companyChanged || addressChanged) {
      pushCustomerToShopify(customer.shopifyGid, {
        company: companyChanged ? (customer.company ?? null) : undefined,
        shippingAddress: addressChanged ? (customer.shippingAddress as AddressJson | null) : undefined,
      }).catch((err) =>
        console.error('Failed to sync customer to Shopify:', err),
      );
    }

    return NextResponse.json({ ok: true, customer });
  } catch (err) {
    return toApiErrorResponse(err, 'PATCH /api/shopify/customers/[id] error:');
  }
}
