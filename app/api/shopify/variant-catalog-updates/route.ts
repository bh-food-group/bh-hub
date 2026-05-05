import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { parseBody, shopifyVariantCatalogUpdatesBodySchema } from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import { getShopifyAdminEnv } from '@/lib/shopify/env';
import { applyVariantCatalogPriceUpdates } from '@/lib/shopify/orderEdit';

export async function POST(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, shopifyVariantCatalogUpdatesBodySchema);
    if ('error' in parsed) return parsed.error;
    const { data } = parsed;

    const creds = getShopifyAdminEnv();
    await applyVariantCatalogPriceUpdates(creds, data.updates);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'POST /api/shopify/variant-catalog-updates');
  }
}
