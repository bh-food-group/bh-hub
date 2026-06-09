import { prisma } from '@/lib/core/prisma';
import type { UserRole } from '@/types/user';
import { USER_ROLES } from '@/types/user';

/** Cache tag for the admin/office "Pending approvals" list. Revalidate this
 * whenever a user's onboarding/approval status changes so the box updates
 * immediately instead of waiting for the 60s time-based revalidation. */
export const PENDING_APPROVALS_TAG = 'pending-approvals';

export type PendingUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  location: string | null;
};

export async function getPendingApprovals(): Promise<PendingUser[]> {
  const roles = USER_ROLES.filter((r) => r !== 'admin');

  const users = await prisma.user.findMany({
    where: {
      status: 'pending_approval',
      ...{ role: { in: roles } },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      location: { select: { code: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return users.map((u) => ({
    id: u.id,
    name: u.name ?? '',
    email: u.email ?? '',
    role: u.role!,
    location: u.location ? `${u.location.code} – ${u.location.name}` : null,
  }));
}
