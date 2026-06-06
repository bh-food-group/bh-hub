// GET /api/labor/day?location=<id>&date=YYYY-MM-DD
//   → forecast + fixed payroll inputs and the computed budget cascade for a date,
//     WITHOUT generating/persisting a plan. Feeds the budget planner screen.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/core';
import { getLaborAuthContext } from '@/lib/labor/api-auth';
import {
  computeBudgetCascade,
  getLaborSettings,
  isValidDate,
} from '@/features/labor/data';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') ?? '';

  const ctx = await getLaborAuthContext(searchParams.get('location'));
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!isValidDate(date)) {
    return NextResponse.json(
      { error: 'date must be YYYY-MM-DD' },
      { status: 400 },
    );
  }

  const [settings, forecastRow, payrollRow] = await Promise.all([
    getLaborSettings(ctx.locationId),
    prisma.revenueForecast.findUnique({
      where: { locationId_date: { locationId: ctx.locationId, date } },
      select: { amount: true },
    }),
    prisma.fixedPayroll.findUnique({
      where: { locationId_date: { locationId: ctx.locationId, date } },
      select: { amount: true },
    }),
  ]);

  const revenueForecast = forecastRow ? Number(forecastRow.amount) : 0;
  const fixedPayroll = payrollRow ? Number(payrollRow.amount) : 0;
  const cascade = computeBudgetCascade({
    revenueForecast,
    fixedPayroll,
    budgetPct: settings.budgetPct,
    wage: settings.wage,
  });

  return NextResponse.json({
    locationId: ctx.locationId,
    date,
    forecastMissing: !forecastRow,
    fixedPayrollMissing: !payrollRow,
    revenueForecast,
    fixedPayroll,
    cascade,
    settings,
  });
}
