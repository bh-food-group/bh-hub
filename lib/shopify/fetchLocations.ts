import { createAdminApiClient } from '@shopify/admin-api-client';
import { getShopifyAdminEnv } from '@/lib/shopify/env';
import type { ShopifyAdminCredentials } from '@/types/shopify';

const LOCATIONS_QUERY = `query ShopifyLocations($first: Int!) {
  locations(first: $first, includeInactive: false) {
    nodes {
      id
      name
      isActive
    }
  }
}`;

type LocationsQueryData = {
  locations: {
    nodes: Array<{
      id: string;
      name: string;
      isActive: boolean;
    }>;
  };
};

export type ShopifyLocation = {
  id: string;
  name: string;
};

export async function fetchShopifyLocations(
  creds: ShopifyAdminCredentials,
  first = 100,
): Promise<ShopifyLocation[]> {
  const client = createAdminApiClient({
    storeDomain: creds.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    apiVersion: creds.apiVersion,
    accessToken: creds.accessToken,
  });

  const { data, errors } = await client.request<LocationsQueryData>(
    LOCATIONS_QUERY,
    { variables: { first } },
  );

  const errList = Array.isArray(errors) ? errors : errors ? [errors] : [];
  if (errList.length > 0) {
    const msg = errList
      .map((e) =>
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: string }).message)
          : String(e),
      )
      .join('; ');
    throw new Error(`Shopify locations query failed: ${msg}`);
  }

  if (!data?.locations) {
    throw new Error('Shopify locations query returned no data');
  }

  return data.locations.nodes
    .filter((l) => l.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function fetchShopifyLocationsFromEnv(first?: number) {
  return fetchShopifyLocations(getShopifyAdminEnv(), first);
}
