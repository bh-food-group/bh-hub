import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { OFFICE_TABLE_VIEW_FETCH_LIMIT } from '@/features/order/office/constants/office-table-view';
import {
  parseOfficeTableListQuery,
  queryPoTableRows,
} from '@/lib/order/office-table-view-query';
import { toApiErrorResponse } from '@/lib/core/errors';

function parseOffsetLimit(searchParams: URLSearchParams) {
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);
  const rawLimit = parseInt(
    searchParams.get('limit') ?? String(OFFICE_TABLE_VIEW_FETCH_LIMIT),
    10,
  );
  const limit = Math.min(
    OFFICE_TABLE_VIEW_FETCH_LIMIT,
    Math.max(1, Number.isFinite(rawLimit) ? rawLimit : OFFICE_TABLE_VIEW_FETCH_LIMIT),
  );
  return { offset, limit };
}

export async function GET(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const sp = request.nextUrl.searchParams;
    const { offset, limit } = parseOffsetLimit(sp);
    const query = parseOfficeTableListQuery(sp, 'po');
    const { rows, total } = await queryPoTableRows(query, offset, limit);
    return NextResponse.json({ ok: true, rows, total });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/order/table-view/po error:');
  }
}
