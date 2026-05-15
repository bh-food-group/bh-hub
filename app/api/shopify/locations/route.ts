import { NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { fetchShopifyLocationsFromEnv } from '@/lib/shopify/fetchLocations';
import { toApiErrorResponse } from '@/lib/core/errors';

export async function GET() {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const locations = await fetchShopifyLocationsFromEnv();
    return NextResponse.json({ ok: true, locations });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/shopify/locations error:');
  }
}
