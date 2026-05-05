import { type NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';

// 1×1 transparent GIF
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('t');

  if (token) {
    try {
      const openedAt = new Date();
      const deliveries = await prisma.poEmailDelivery.findMany({
        where: { trackingToken: token, openedAt: null },
        select: { id: true, purchaseOrderId: true },
      });
      if (deliveries.length > 0) {
        const ids = deliveries.map((d) => d.id);
        const poIds = [...new Set(deliveries.map((d) => d.purchaseOrderId))];
        await Promise.all([
          prisma.poEmailDelivery.updateMany({
            where: { id: { in: ids } },
            data: { openedAt },
          }),
          prisma.purchaseOrder.updateMany({
            where: { id: { in: poIds }, emailOpenedAt: null },
            data: { emailOpenedAt: openedAt },
          }),
        ]);
      }
    } catch {
      // Never fail a tracking request
    }
  }

  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}
