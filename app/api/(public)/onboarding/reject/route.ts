import { parseBody, onboardingRejectPostSchema } from '@/lib/api/schemas';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { PENDING_APPROVALS_TAG } from '@/features/onboard/utils/onboarding';
import { UserRole } from '@prisma/client';
import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

const APPROVER_ROLES: UserRole[] = ['admin', 'office'];

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role;
  if (!role || !APPROVER_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = await parseBody(request, onboardingRejectPostSchema);
  if ('error' in parsed) return parsed.error;
  const { userId, reason } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, role: true },
  });

  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  if (target.status !== 'pending_approval') {
    return NextResponse.json(
      { error: 'User is not pending approval' },
      { status: 400 }
    );
  }

  if (role === 'office' && target.role !== 'manager') {
    return NextResponse.json(
      { error: 'Office can only reject managers' },
      { status: 403 }
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      status: 'rejected',
      rejectReason: reason || null,
    },
  });

  // Drop the rejected user from the "Pending approvals" box immediately.
  revalidateTag(PENDING_APPROVALS_TAG, { expire: 0 });

  return NextResponse.json({ ok: true });
}
