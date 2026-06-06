// POST /api/labor/forecast  → upsert a MONTHLY revenue forecast (OFFICE/ADMIN only)
//
// body: { location: string, yearMonth: "YYYY-MM", amount: number }

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/core';
import { getLaborAuthContext } from '@/lib/labor/api-auth';
import { isValidYearMonth } from '@/features/labor/data';

const Body = z.object({
  location: z.string().min(1),
  yearMonth: z.string().refine(isValidYearMonth, 'yearMonth must be YYYY-MM'),
  amount: z.number().nonnegative(),
});

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid body' },
      { status: 400 },
    );
  }
  const { location, yearMonth, amount } = parsed.data;

  const ctx = await getLaborAuthContext(location);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  // Revenue forecast is an office responsibility.
  if (!ctx.isOfficeOrAdmin) {
    return NextResponse.json(
      { error: 'Only office or admin can set the revenue forecast' },
      { status: 403 },
    );
  }

  await prisma.revenueForecast.upsert({
    where: { locationId_yearMonth: { locationId: ctx.locationId, yearMonth } },
    create: {
      locationId: ctx.locationId,
      yearMonth,
      amount,
      createdById: ctx.userId,
    },
    update: { amount, createdById: ctx.userId },
  });

  return NextResponse.json({
    ok: true,
    locationId: ctx.locationId,
    yearMonth,
    amount,
  });
}
