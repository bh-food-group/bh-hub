// GET    /api/labor/exclusions?location=<id>          → list excluded sample dates
// POST   /api/labor/exclusions                         → add { location, date, reason? }
// DELETE /api/labor/exclusions?location=<id>&date=...  → remove an exclusion
//
// Excluded dates are dropped from the trailing heatmap sample (holidays,
// closures, events). Any authorized user for the location may manage them.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/core';
import { getLaborAuthContext } from '@/lib/labor/api-auth';
import { isValidDate } from '@/features/labor/data';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ctx = await getLaborAuthContext(searchParams.get('location'));
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const rows = await prisma.salesSampleExclusion.findMany({
    where: { locationId: ctx.locationId },
    orderBy: { businessDate: 'desc' },
    select: { businessDate: true, reason: true, createdAt: true },
  });
  return NextResponse.json({ locationId: ctx.locationId, exclusions: rows });
}

const PostBody = z.object({
  location: z.string().min(1),
  date: z.string().refine(isValidDate, 'date must be YYYY-MM-DD'),
  reason: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const parsed = PostBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid body' },
      { status: 400 },
    );
  }
  const { location, date, reason } = parsed.data;

  const ctx = await getLaborAuthContext(location);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  await prisma.salesSampleExclusion.upsert({
    where: {
      locationId_businessDate: { locationId: ctx.locationId, businessDate: date },
    },
    create: {
      locationId: ctx.locationId,
      businessDate: date,
      reason: reason ?? null,
      createdById: ctx.userId,
    },
    update: { reason: reason ?? null, createdById: ctx.userId },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') ?? '';

  const ctx = await getLaborAuthContext(searchParams.get('location'));
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!isValidDate(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  await prisma.salesSampleExclusion.deleteMany({
    where: { locationId: ctx.locationId, businessDate: date },
  });
  return NextResponse.json({ ok: true });
}
