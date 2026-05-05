import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { toApiErrorResponse } from '@/lib/core/errors';
import { getShopifyAdminEnv, isShopifyAdminEnvConfigured } from '@/lib/shopify/env';
import {
  fetchDraftProductCountForCatalogFilters,
  fetchProductsCatalogPage,
  type OfficeCatalogStatusScope,
} from '@/lib/shopify/listProductsCatalog';

export async function GET(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    if (!isShopifyAdminEnvConfigured()) {
      return NextResponse.json(
        { error: 'Shopify Admin API is not configured on the server.' },
        { status: 503 },
      );
    }

    const sp = request.nextUrl.searchParams;
    const after = sp.get('after')?.trim() || null;
    const vendor = sp.get('vendor')?.trim() || null;
    const title =
      sp.get('title')?.trim() ||
      sp.get('q')?.trim() ||
      null;
    const includeDraft =
      sp.get('includeDraft') === '1' ||
      sp.get('includeDraft') === 'true' ||
      sp.get('includeDrafts') === '1' ||
      sp.get('includeDrafts') === 'true';
    const firstRaw = sp.get('first');
    const first = Math.min(
      50,
      Math.max(1, firstRaw ? parseInt(firstRaw, 10) || 25 : 25),
    );

    const creds = getShopifyAdminEnv();
    const statusScope: OfficeCatalogStatusScope = includeDraft
      ? 'active_and_draft'
      : 'active_only';

    const filterArgs = { vendorFilter: vendor, titleSearch: title };
    const [page, draftProductCount] = await Promise.all([
      fetchProductsCatalogPage(creds, {
        first,
        after,
        ...filterArgs,
        statusScope,
      }),
      fetchDraftProductCountForCatalogFilters(creds, filterArgs),
    ]);

    return NextResponse.json({
      ok: true,
      rows: page.rows,
      endCursor: page.endCursor,
      hasNextPage: page.hasNextPage,
      draftProductCount,
    });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/shopify/products/catalog');
  }
}
