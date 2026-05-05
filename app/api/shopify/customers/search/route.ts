import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { toApiErrorResponse } from '@/lib/core/errors';
import { isShopifyAdminEnvConfigured } from '@/lib/shopify/env';
import { searchCustomersForOfficeFromEnv } from '@/lib/shopify/searchCustomersForOffice';

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

    const hits = await searchCustomersForOfficeFromEnv(q, 25);
    return NextResponse.json({ ok: true, hits });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/shopify/customers/search');
  }
}
