import { NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';

export async function GET() {
  const gate = await requireOrderManager();
  if (!gate.ok) return gate.response;

  const agg = await prisma.shopifyOrder.aggregate({
    _max: { syncedAt: true },
    _count: { id: true },
  });

  return NextResponse.json({
    lastSyncedAt: agg._max.syncedAt?.toISOString() ?? null,
    totalOrders: agg._count.id,
  });
}
