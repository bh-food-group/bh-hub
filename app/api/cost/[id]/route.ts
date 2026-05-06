import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }

    const { id } = await context.params;

    const cost = await prisma.cost.findUnique({
      where: { id },
      include: {
        ingredients: { orderBy: { rank: 'asc' } },
        packagings: { orderBy: { rank: 'asc' } },
        costMemos: {
          orderBy: { rank: 'asc' },
          select: { id: true, memo: true, rank: true },
        },
      },
    });

    if (!cost) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ cost });
  } catch (err) {
    return toApiErrorResponse(err, 'GET /api/cost/[id] error:');
  }
}
