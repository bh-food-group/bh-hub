// GET  /api/labor/settings?location=<id>  → resolved settings (defaults if unset)
// PUT  /api/labor/settings                 → upsert settings (OFFICE/ADMIN only)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/core';
import { getLaborAuthContext } from '@/lib/labor/api-auth';
import { getLaborSettings } from '@/features/labor/data';
import { getBcMinimumWage } from '@/lib/labor/constants';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ctx = await getLaborAuthContext(searchParams.get('location'));
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const settings = await getLaborSettings(ctx.locationId);
  return NextResponse.json({
    settings,
    bcMinimumWage: getBcMinimumWage(),
    wageBelowMinimum: settings.wage < getBcMinimumWage(),
  });
}

const Body = z.object({
  location: z.string().min(1),
  budgetPct: z.number().positive().max(1),
  wage: z.number().positive(),
  minCov: z.number().int().min(0),
  maxCov: z.number().int().min(1),
  minShiftHrs: z.number().positive(),
  maxShiftHrs: z.number().positive(),
  increment: z.number().positive(),
  openHour: z.number().int().min(0).max(23),
  closeHour: z.number().int().min(0).max(23),
});

export async function PUT(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid body' },
      { status: 400 },
    );
  }
  const s = parsed.data;

  const ctx = await getLaborAuthContext(s.location);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ctx.isOfficeOrAdmin) {
    return NextResponse.json(
      { error: 'Only office or admin can edit labor settings' },
      { status: 403 },
    );
  }

  // Semantic guards the engine relies on.
  if (s.maxCov < s.minCov) {
    return NextResponse.json(
      { error: 'max_cov must be >= min_cov' },
      { status: 400 },
    );
  }
  if (s.maxShiftHrs < s.minShiftHrs) {
    return NextResponse.json(
      { error: 'max_shift_hrs must be >= min_shift_hrs' },
      { status: 400 },
    );
  }
  if (s.closeHour < s.openHour) {
    return NextResponse.json(
      { error: 'close_hour must be >= open_hour' },
      { status: 400 },
    );
  }

  await prisma.laborSettings.upsert({
    where: { locationId: ctx.locationId },
    create: {
      locationId: ctx.locationId,
      budgetPct: s.budgetPct,
      wage: s.wage,
      minCov: s.minCov,
      maxCov: s.maxCov,
      minShiftHrs: s.minShiftHrs,
      maxShiftHrs: s.maxShiftHrs,
      increment: s.increment,
      openHour: s.openHour,
      closeHour: s.closeHour,
    },
    update: {
      budgetPct: s.budgetPct,
      wage: s.wage,
      minCov: s.minCov,
      maxCov: s.maxCov,
      minShiftHrs: s.minShiftHrs,
      maxShiftHrs: s.maxShiftHrs,
      increment: s.increment,
      openHour: s.openHour,
      closeHour: s.closeHour,
    },
  });

  const settings = await getLaborSettings(ctx.locationId);
  return NextResponse.json({ ok: true, settings });
}
