import { recomputeRevenueTargetSharesForLocation } from '@/features/dashboard/revenue/utils/recompute-revenue-target-shares';
import { invalidateRevenueSnapshotCache } from '@/features/dashboard/revenue/utils/revenue-target-snapshot';
import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { toApiErrorResponse } from '@/lib/core/errors';
import { prisma } from '@/lib/core/prisma';
import { getCurrentYearMonth, isValidYearMonth } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const patchBodySchema = z.object({
  appliesYearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  referencePeriodMonths: z.number().int().min(0).max(24),
});

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ locationId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { locationId } = await ctx.params;
    const isOfficeOrAdmin = getOfficeOrAdmin(session.user.role);
    if (!isOfficeOrAdmin && session.user.locationId !== locationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearMonth =
      searchParams.get('yearMonth')?.trim() || getCurrentYearMonth();
    if (!isValidYearMonth(yearMonth)) {
      return NextResponse.json(
        { error: 'Invalid yearMonth; use YYYY-MM' },
        { status: 400 },
      );
    }

    const loc = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true },
    });
    if (!loc) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const monthRow = await prisma.revenueMonthTarget.findUnique({
      where: {
        locationId_appliesYearMonth: { locationId, appliesYearMonth: yearMonth },
      },
    });

    return NextResponse.json({
      ok: true,
      appliesYearMonth: yearMonth,
      referencePeriodMonths: monthRow?.referencePeriodMonths ?? null,
      hasShares: Boolean(monthRow?.sharesJson?.trim()),
    });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET revenue-target');
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ locationId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { locationId } = await ctx.params;

    if (!getOfficeOrAdmin(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const json: unknown = await request.json().catch(() => null);
    const parsed = patchBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { appliesYearMonth, referencePeriodMonths } = parsed.data;
    if (!isValidYearMonth(appliesYearMonth)) {
      return NextResponse.json(
        { error: 'Invalid appliesYearMonth' },
        { status: 400 },
      );
    }

    const loc = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true },
    });
    if (!loc) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const beforeMonth = await prisma.revenueMonthTarget.findUnique({
      where: {
        locationId_appliesYearMonth: { locationId, appliesYearMonth },
      },
    });

    const refChanged =
      beforeMonth?.referencePeriodMonths !== referencePeriodMonths;
    const needsShares =
      !beforeMonth?.sharesJson?.trim() || refChanged;

    if (needsShares) {
      await recomputeRevenueTargetSharesForLocation(
        locationId,
        appliesYearMonth,
        referencePeriodMonths,
      );
    }
    invalidateRevenueSnapshotCache(locationId, appliesYearMonth); // L1 in-memory

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Clover is not configured')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return toApiErrorResponse(err, 'PATCH revenue-target');
  }
}
