// GET /api/labor/heatmap?location=<id>  → cached weekday×hour heatmap + sample_n
//
// Returns the nightly trimmed-mean matrix. `from`/`to` are reserved for a future
// ad-hoc window; the served matrix is the standard trailing-8-week cache.

import { NextRequest, NextResponse } from 'next/server';
import { getLaborAuthContext } from '@/lib/labor/api-auth';
import { readHeatmap } from '@/features/labor/data';
import { getLaborSettings } from '@/features/labor/data';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ctx = await getLaborAuthContext(searchParams.get('location'));
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const [cells, settings] = await Promise.all([
    readHeatmap(ctx.locationId),
    getLaborSettings(ctx.locationId),
  ]);

  return NextResponse.json({
    locationId: ctx.locationId,
    openHour: settings.openHour,
    closeHour: settings.closeHour,
    configured: settings.configured,
    cells,
  });
}
