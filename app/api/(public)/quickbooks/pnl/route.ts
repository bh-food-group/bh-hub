// GET /api/quickbooks/pnl — Full Profit and Loss report from QuickBooks.
// Query: locationId (required), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), accountingMethod (optional: Accrual | Cash).
// Response.report is parsable for P&L PDF (same structure as bhpnl ReportData: Header, Rows, Columns).
// Use getIncomeFromPnlReport / getIncomeWithCategoriesFromPnlReport / getCosFromPnlReport / getBudgetDataFromPnlReport in lib for income/cos.

import { NextRequest, NextResponse } from 'next/server';
import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { toApiErrorResponse } from '@/lib/core/errors';
import type { PnlReportData } from '@/lib/quickbooks';
import { prisma } from '@/lib/core/prisma';
import { fetchQbPnlCached } from '@/lib/quickbooks/pnl-cache';

function parseDate(s: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const [, y, m, d] = match;
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${m}-${d}`;
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get('locationId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const accountingMethod =
      (searchParams.get('accountingMethod') as 'Accrual' | 'Cash') || 'Accrual';

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 },
      );
    }

    const start = startDate ? parseDate(startDate) : null;
    const end = endDate ? parseDate(endDate) : null;
    if (!start || !end) {
      return NextResponse.json(
        { error: 'startDate and endDate (YYYY-MM-DD) are required' },
        { status: 400 },
      );
    }
    if (new Date(start) > new Date(end)) {
      return NextResponse.json(
        { error: 'startDate must be before or equal to endDate' },
        { status: 400 },
      );
    }

    const isOfficeOrAdmin = getOfficeOrAdmin(session.user.role);
    const managerLocationId = session.user.locationId ?? undefined;
    if (!isOfficeOrAdmin && managerLocationId !== locationId) {
      return NextResponse.json(
        { error: 'You can only request PnL for your own location' },
        { status: 403 },
      );
    }

    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, code: true, name: true },
    });
    if (!location) {
      return NextResponse.json(
        { error: 'Location not found' },
        { status: 404 },
      );
    }

    const report = await fetchQbPnlCached(locationId, start, end, accountingMethod);

    const body = {
      ok: true,
      locationId,
      location: { id: location.id, code: location.code, name: location.name },
      startDate: start,
      endDate: end,
      accountingMethod,
      report: report as PnlReportData,
    };
    return NextResponse.json(body);
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/quickbooks/pnl error:');
  }
}
