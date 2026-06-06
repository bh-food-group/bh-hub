// GET /api/labor/week?location=<id>&week_start=YYYY-MM-DD
//   → 7-day budget + plan rollup (secondary to the daily flow).

import { NextRequest, NextResponse } from 'next/server';
import { getLaborAuthContext } from '@/lib/labor/api-auth';
import { generateWeek, isValidDate } from '@/features/labor/data';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const weekStart = searchParams.get('week_start') ?? '';

  const ctx = await getLaborAuthContext(searchParams.get('location'));
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!isValidDate(weekStart)) {
    return NextResponse.json(
      { error: 'week_start must be YYYY-MM-DD' },
      { status: 400 },
    );
  }

  const rollup = await generateWeek(ctx.locationId, weekStart);
  return NextResponse.json({ locationId: ctx.locationId, ...rollup });
}
