// POST /api/labor/plan  → run the cascade + engine for { location, date },
// persist the plan, and return the plan + rendered table model.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getLaborAuthContext } from '@/lib/labor/api-auth';
import { generatePlan, isValidDate } from '@/features/labor/data';

const Body = z.object({
  location: z.string().min(1),
  date: z.string().refine(isValidDate, 'date must be YYYY-MM-DD'),
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
  const { location, date } = parsed.data;

  const ctx = await getLaborAuthContext(location);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const plan = await generatePlan(ctx.locationId, date);
  return NextResponse.json({ locationId: ctx.locationId, plan });
}
