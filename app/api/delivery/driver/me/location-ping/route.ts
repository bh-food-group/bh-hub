/**
 * GET /api/delivery/driver/me/location-ping
 * Auth: Bearer driver JWT.
 * Returns whether the office requested a fresh GPS fix, and whether GPS tracking
 * should be active (first stop arrived, last stop not yet arrived).
 */

import { verifyDriverToken } from '@/lib/delivery/driver-auth';
import { prisma } from '@/lib/core/prisma';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const payload = verifyDriverToken(authHeader);
  if (!payload) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const [driver, stops] = await Promise.all([
    prisma.driver.findUnique({
      where: { id: payload.driverId },
      select: { locationPingRequestedAt: true },
    }),
    prisma.dailyScheduleStop.findMany({
      where: { driverId: payload.driverId, date: todayUtc },
      orderBy: { sequence: 'asc' },
      select: { arrivedAt: true },
    }),
  ]);

  // Tracking window: first stop has arrived, last stop has not yet arrived.
  const firstStop = stops[0] ?? null;
  const lastStop = stops[stops.length - 1] ?? null;
  const trackingActive =
    stops.length > 0 &&
    firstStop?.arrivedAt != null &&
    lastStop?.arrivedAt == null;

  return NextResponse.json({
    pingRequestedAt: driver?.locationPingRequestedAt?.toISOString() ?? null,
    trackingActive,
  });
}
