import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { toApiErrorResponse } from '@/lib/core/errors';
import { getShopifyAdminEnv, isShopifyAdminEnvConfigured } from '@/lib/shopify/env';
import {
  fetchDraftProductCountForOfficeSearch,
  searchProductsForOfficeFromEnv,
} from '@/lib/shopify/searchProducts';

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

    const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
    if (q.length < 2) {
      return NextResponse.json(
        { error: 'Enter at least 2 characters to search.' },
        { status: 400 },
      );
    }

    const sp = request.nextUrl.searchParams;
    const includeDraft =
      sp.get('includeDraft') === '1' ||
      sp.get('includeDraft') === 'true' ||
      sp.get('includeDrafts') === '1' ||
      sp.get('includeDrafts') === 'true';

    const creds = getShopifyAdminEnv();
    const [hits, draftProductCount] = await Promise.all([
      searchProductsForOfficeFromEnv(q, 12, { includeDrafts: includeDraft }),
      fetchDraftProductCountForOfficeSearch(creds, q),
    ]);
    return NextResponse.json({ ok: true, hits, draftProductCount });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/shopify/products/search');
  }
}
