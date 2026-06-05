/**
 * Admin GraphQL product search for office “add line” flows. Requires `read_products`.
 */

import { createAdminApiClient } from '@shopify/admin-api-client';
import { shopifyMoneyAmountToDecimalString } from '@/lib/shopify/graphql-money';
import { getShopifyAdminEnv } from '@/lib/shopify/env';
import type { ShopifyAdminCredentials } from '@/types/shopify';

const PRODUCTS_COUNT = `query OfficeSearchProductsCount($query: String!) {
  productsCount(query: $query) {
    count
  }
}`;

const PRODUCTS_SEARCH = `query OfficeProductsSearch($first: Int!, $query: String!) {
  products(first: $first, query: $query) {
    edges {
      node {
        id
        title
        status
        handle
        featuredImage {
          url
        }
        variants(first: 25) {
          edges {
            node {
              id
              title
              sku
              price
              image {
                url
              }
            }
          }
        }
      }
    }
  }
}`;

const PRODUCTS_SEARCH_PAGINATED = `query OfficeProductsSearchPaginated($first: Int!, $query: String!, $after: String) {
  products(first: $first, query: $query, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      cursor
      node {
        id
        title
        status
        featuredImage {
          url
        }
        variants(first: 25) {
          edges {
            node {
              id
              title
              sku
              price
              image {
                url
              }
            }
          }
        }
      }
    }
  }
}`;

type OfficeProductSearchPaginatedData = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      cursor: string;
      node: OfficeProductSearchData['products']['edges'][number]['node'];
    }>;
  };
};

export type IngredientSearchPage = {
  hits: OfficeProductSearchVariantHit[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type OfficeProductSearchProductStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED';

export type OfficeProductSearchVariantHit = {
  productId: string;
  productTitle: string;
  productStatus: OfficeProductSearchProductStatus;
  variantId: string;
  variantTitle: string | null;
  sku: string | null;
  price: string | null;
  /** Variant inventory unit cost (Shopify), when present. */
  unitCost: string | null;
  /** Variant image, else product featured image. */
  imageUrl: string | null;
};

export type OfficeProductSearchData = {
  products: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        status: string;
        handle: string;
        featuredImage?: { url: string | null } | null;
        variants: {
          edges: Array<{
            node: {
              id: string;
              title: string | null;
              sku: string | null;
              price?: unknown;
              image?: { url: string | null } | null;
            };
          }>;
        };
      };
    }>;
  };
};

type OfficeProductsCountData = {
  productsCount?: { count?: number | null } | null;
};

function normalizeProductStatus(raw: string | undefined | null): OfficeProductSearchProductStatus {
  const s = (raw ?? '').trim().toUpperCase();
  if (s === 'DRAFT' || s === 'ACTIVE' || s === 'ARCHIVED') return s;
  return 'ACTIVE';
}

/**
 * Builds a `(vendor:'A' OR vendor:'B')` clause to scope a product search to one
 * supplier's vendor name(s). Returns null when there are no usable names, so the
 * caller leaves the query unscoped. Single quotes/backslashes are escaped for
 * Shopify's search syntax.
 */
function shopifyVendorScopeClause(vendorNames: readonly string[] | undefined): string | null {
  if (!vendorNames || vendorNames.length === 0) return null;
  const parts = Array.from(
    new Set(vendorNames.map((v) => v.trim()).filter((v) => v.length > 0)),
  ).map((v) => `vendor:'${v.replace(/(['\\])/g, '\\$1')}'`);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`;
}

function shopifySearchQueryWithStatusScope(
  userQuery: string,
  includeDrafts: boolean,
  vendorNames?: readonly string[],
): string {
  const q = userQuery.trim();
  const statusPart = includeDrafts ? '(status:active OR status:draft)' : 'status:active';
  const vendorPart = shopifyVendorScopeClause(vendorNames);
  return [q || null, statusPart, vendorPart].filter(Boolean).join(' AND ');
}

function shopifyDraftCountQueryForSearch(
  userQuery: string,
  vendorNames?: readonly string[],
): string {
  const q = userQuery.trim();
  const vendorPart = shopifyVendorScopeClause(vendorNames);
  return [q || null, 'status:draft', vendorPart].filter(Boolean).join(' AND ');
}

export async function fetchDraftProductCountForOfficeSearch(
  creds: ShopifyAdminCredentials,
  userQuery: string,
  opts?: { vendorNames?: readonly string[] },
): Promise<number> {
  const client = createAdminApiClient({
    storeDomain: creds.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    apiVersion: creds.apiVersion,
    accessToken: creds.accessToken,
  });
  const query = shopifyDraftCountQueryForSearch(userQuery, opts?.vendorNames);
  const { data, errors } = await client.request<OfficeProductsCountData>(PRODUCTS_COUNT, {
    variables: { query },
  });
  const errList = Array.isArray(errors) ? errors : errors ? [errors] : [];
  if (errList.length > 0) {
    const msg = errList
      .map((e) =>
        e && typeof e === 'object' && 'message' in e ? String((e as { message?: string }).message) : String(e),
      )
      .join('; ');
    throw new Error(`Shopify productsCount failed: ${msg}`);
  }
  const n = data?.productsCount?.count;
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0;
}

export async function searchProductsForOffice(
  creds: ShopifyAdminCredentials,
  query: string,
  first = 15,
  opts?: { includeDrafts?: boolean; vendorNames?: readonly string[] },
): Promise<OfficeProductSearchVariantHit[]> {
  const client = createAdminApiClient({
    storeDomain: creds.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    apiVersion: creds.apiVersion,
    accessToken: creds.accessToken,
  });

  const scopedQuery = shopifySearchQueryWithStatusScope(
    query,
    Boolean(opts?.includeDrafts),
    opts?.vendorNames,
  );

  const { data, errors } = await client.request<OfficeProductSearchData>(PRODUCTS_SEARCH, {
    variables: { first, query: scopedQuery },
  });
  const errList = Array.isArray(errors) ? errors : errors ? [errors] : [];
  if (errList.length > 0) {
    const msg = errList
      .map((e) =>
        e && typeof e === 'object' && 'message' in e ? String((e as { message?: string }).message) : String(e),
      )
      .join('; ');
    throw new Error(`Shopify products search failed: ${msg}`);
  }

  const hits: OfficeProductSearchVariantHit[] = [];
  for (const edge of data?.products?.edges ?? []) {
    const p = edge.node;
    const productStatus = normalizeProductStatus(p.status);
    for (const ve of p.variants.edges) {
      const v = ve.node;
      const imageUrl =
        v.image?.url?.trim() ||
        p.featuredImage?.url?.trim() ||
        null;
      hits.push({
        productId: p.id,
        productTitle: p.title,
        productStatus,
        variantId: v.id,
        variantTitle: v.title,
        sku: v.sku,
        price: shopifyMoneyAmountToDecimalString(v.price),
        unitCost: null,
        imageUrl,
      });
    }
  }
  return hits;
}

export function searchProductsForOfficeFromEnv(
  query: string,
  first?: number,
  opts?: { includeDrafts?: boolean; vendorNames?: readonly string[] },
) {
  return searchProductsForOffice(getShopifyAdminEnv(), query, first, opts);
}

const BATCH_SIZE = 20;

/**
 * Fetch one batch of title-matching products for infinite scroll.
 * Walks Shopify pages (250/page) from `afterCursor` until `BATCH_SIZE` title
 * matches are found, then returns them with a cursor the client can send back.
 *
 * `nextCursor` points to the last matched variant's product edge cursor so the
 * next call resumes exactly where this one stopped.
 */
export async function fetchIngredientSearchPage(
  creds: ShopifyAdminCredentials,
  userQuery: string,
  afterCursor: string | null = null,
  opts?: { includeDrafts?: boolean },
): Promise<IngredientSearchPage> {
  const client = createAdminApiClient({
    storeDomain: creds.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    apiVersion: creds.apiVersion,
    accessToken: creds.accessToken,
  });

  const scopedQuery = shopifySearchQueryWithStatusScope(userQuery, Boolean(opts?.includeDrafts));
  const ql = userQuery.trim().toLowerCase();
  const hits: OfficeProductSearchVariantHit[] = [];
  let shopifyCursor: string | null = afterCursor;
  // cursor of the last product edge that yielded a match — used as nextCursor
  let lastMatchEdgeCursor: string | null = null;
  // whether there are more Shopify pages beyond the last one we fetched
  let shopifyHasMore = false;

  outer: while (hits.length < BATCH_SIZE) {
    const result: { data?: OfficeProductSearchPaginatedData; errors?: unknown } =
      await client.request<OfficeProductSearchPaginatedData>(
        PRODUCTS_SEARCH_PAGINATED,
        { variables: { first: 250, query: scopedQuery, after: shopifyCursor } },
      );

    const errList = Array.isArray(result.errors) ? result.errors : result.errors ? [result.errors] : [];
    if (errList.length > 0) {
      const msg = (errList as unknown[])
        .map((e) => e && typeof e === 'object' && 'message' in e ? String((e as { message?: string }).message) : String(e))
        .join('; ');
      throw new Error(`Shopify products search failed: ${msg}`);
    }

    const page: OfficeProductSearchPaginatedData['products'] | undefined = result.data?.products;
    if (!page) break;

    shopifyHasMore = page.pageInfo.hasNextPage;

    for (const edge of page.edges) {
      const p = edge.node;
      if (!p.title.toLowerCase().includes(ql)) continue;

      const productStatus = normalizeProductStatus(p.status);
      for (const ve of p.variants.edges) {
        const v = ve.node;
        const imageUrl = v.image?.url?.trim() || p.featuredImage?.url?.trim() || null;
        hits.push({
          productId: p.id,
          productTitle: p.title,
          productStatus,
          variantId: v.id,
          variantTitle: v.title,
          sku: v.sku,
          price: shopifyMoneyAmountToDecimalString(v.price),
          unitCost: null,
          imageUrl,
        });
      }
      lastMatchEdgeCursor = edge.cursor;

      if (hits.length >= BATCH_SIZE) break outer;
    }

    if (!page.pageInfo.hasNextPage) break;
    shopifyCursor = page.pageInfo.endCursor;
  }

  const hasMore = hits.length >= BATCH_SIZE || shopifyHasMore;

  return {
    hits,
    nextCursor: hasMore ? lastMatchEdgeCursor : null,
    hasMore,
  };
}

export function fetchIngredientSearchPageFromEnv(
  userQuery: string,
  afterCursor: string | null = null,
  opts?: { includeDrafts?: boolean },
) {
  return fetchIngredientSearchPage(getShopifyAdminEnv(), userQuery, afterCursor, opts);
}
