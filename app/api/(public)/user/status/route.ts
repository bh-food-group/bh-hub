import { auth } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Read from the DB, not the JWT: the waiting-page poller needs to see the
  // approval the moment an admin grants it, but the user's token still holds
  // the stale `pending_approval` status until it is refreshed.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  return NextResponse.json({ status: user?.status ?? session.user.status });
}
