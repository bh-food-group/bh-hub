// POST /api/labor/fixed-payroll  → upsert daily fixed payroll (MANAGER only)
//
// body: { location: string, date: "YYYY-MM-DD", amount: number }
//
// Admin is also permitted (operational override); office is not — fixed payroll
// is the store manager's input per the brief's permission split.

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
  // Fixed payroll is a manager responsibility (admin may override). Office cannot.
  if (!ctx.isManager && ctx.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only a manager can set fixed payroll' },
      { status: 403 },
    );
  }

  await prisma.fixedPayroll.upsert({
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
