// GET /api/labor/week-schedule?location=<id>&week_start=YYYY-MM-DD
//   → full per-day plans (engine tables) for all 7 days of the week, backing the
//     Schedule screen's day tabs.

import { NextRequest, NextResponse } from 'next/server';
import { getLaborAuthContext } from '@/lib/labor/api-auth';
import { generateWeekPlans, isValidDate } from '@/features/labor/data';

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

  const plans = await generateWeekPlans(ctx.locationId, weekStart);
  return NextResponse.json({ locationId: ctx.locationId, weekStart, plans });
}
