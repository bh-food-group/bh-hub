import { parseBody, onboardingPostSchema } from '@/lib/api/schemas';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { PENDING_APPROVALS_TAG } from '@/features/onboard/utils/onboarding';
import { UserStatus } from '@prisma/client';
import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Re-submission guard: a user who has already moved past onboarding must not
  // have their status reset back to pending_approval. Instead of erroring (which
  // would strand them on the form), succeed without changing anything so the
  // client navigates to `/` and the home route routes them by their real status
  // (e.g. /waiting). Only genuine pending_onboarding users fall through to the
  // update below.
  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (current && current.status !== 'pending_onboarding') {
    return NextResponse.json({ ok: true });
  }

  const parsed = await parseBody(request, onboardingPostSchema);
  if ('error' in parsed) return parsed.error;
  const { name, role, locationId } = parsed.data;

  if (role === 'manager' && locationId) {
    const location = await prisma.location.findUnique({
      where: { id: locationId },
    });
    if (!location) {
      return NextResponse.json({ error: 'Invalid location' }, { status: 400 });
    }
  }

  const status: UserStatus = "pending_approval";

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name,
      role,
      status,
      locationId: role === 'manager' ? locationId ?? null : null,
    },
  });

  // Surface this user in the admin/office "Pending approvals" box right away.
  revalidateTag(PENDING_APPROVALS_TAG, { expire: 0 });

  return NextResponse.json({ ok: true });
}
