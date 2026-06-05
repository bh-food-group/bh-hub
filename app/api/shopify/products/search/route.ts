import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { toApiErrorResponse } from '@/lib/core/errors';
import { getShopifyAdminEnv, isShopifyAdminEnvConfigured } from '@/lib/shopify/env';
import {
  fetchDraftProductCountForOfficeSearch,
  searchProductsForOfficeFromEnv,
} from '@/lib/shopify/searchProducts';
import {
  vendorNamesForPurchaseOrderId,
  vendorNamesForSupplierId,
} from '@/lib/order/supplier-vendor-names';

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

    // Scope results to one supplier's vendor name(s) when the caller is editing a
    // supplier-bound order (PO add line, or an inbox draft within a supplier
    // bucket) so cross-supplier items can't be added. `purchaseOrderId` resolves
    // its supplier; `supplierId` is used directly.
    const purchaseOrderId = sp.get('purchaseOrderId')?.trim() || null;
    const supplierId = sp.get('supplierId')?.trim() || null;
    let vendorNames: string[] | undefined;
    if (purchaseOrderId) {
      vendorNames = await vendorNamesForPurchaseOrderId(purchaseOrderId);
    } else if (supplierId) {
      vendorNames = await vendorNamesForSupplierId(supplierId);
    }
    // Supplier requested but it maps to no vendor names → nothing belongs to it.
    if (vendorNames && vendorNames.length === 0) {
      return NextResponse.json({ ok: true, hits: [], draftProductCount: 0 });
    }

    const creds = getShopifyAdminEnv();
    const [hits, draftProductCount] = await Promise.all([
      searchProductsForOfficeFromEnv(q, 12, { includeDrafts: includeDraft, vendorNames }),
      fetchDraftProductCountForOfficeSearch(creds, q, { vendorNames }),
    ]);
    return NextResponse.json({ ok: true, hits, draftProductCount });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/shopify/products/search');
  }
}
