// GET /api/labor/plan/:id  → a stored plan (shifts + coverage), location-scoped.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/core';
import { getLaborAuthContext } from '@/lib/labor/api-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Resolve the plan first so we know its location, then authorize against it.
  const plan = await prisma.laborPlan.findUnique({
    where: { id },
    include: {
      shifts: { orderBy: { shiftIndex: 'asc' } },
      coverage: { orderBy: { hour: 'asc' } },
    },
  });
  if (!plan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  const ctx = await getLaborAuthContext(plan.locationId);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  return NextResponse.json({
    plan: {
      id: plan.id,
      locationId: plan.locationId,
      date: plan.date,
      laborBudget: Number(plan.laborBudget),
      fixedPayroll: Number(plan.fixedPayroll),
      ptLaborFee: Number(plan.ptLaborFee),
      wageUsed: Number(plan.wageUsed),
      affordableHrs: Number(plan.affordableHrs),
      scheduledHrs: Number(plan.scheduledHrs),
      scheduledCost: Number(plan.scheduledCost),
      status: plan.status,
      createdAt: plan.createdAt,
      shifts: plan.shifts.map((s) => ({
        shiftIndex: s.shiftIndex,
        startHour: s.startHour,
        endHour: s.endHour,
        role: s.role,
      })),
      coverage: plan.coverage.map((c) => ({
        hour: c.hour,
        targetHeadcount: Number(c.targetHeadcount),
        salesWeight: Number(c.salesWeight),
        salesAvg: Number(c.salesAvg),
      })),
    },
  });
}
