// POST /api/labor/forecast  → upsert a daily revenue forecast (OFFICE/ADMIN only)
//
// body: { location: string, date: "YYYY-MM-DD", amount: number }

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/core';
import { getLaborAuthContext } from '@/lib/labor/api-auth';
import { isValidDate } from '@/features/labor/data';

const Body = z.object({
  location: z.string().min(1),
  date: z.string().refine(isValidDate, 'date must be YYYY-MM-DD'),
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
  const { location, date, amount } = parsed.data;

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
    where: { locationId_date: { locationId: ctx.locationId, date } },
    create: {
      locationId: ctx.locationId,
      date,
      amount,
      createdById: ctx.userId,
    },
    update: { amount, createdById: ctx.userId },
  });

  return NextResponse.json({ ok: true, locationId: ctx.locationId, date, amount });
}
