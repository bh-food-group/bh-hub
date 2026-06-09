import { auth, getCanSeeBudgetAndReports } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { redirect } from 'next/navigation';

export default async function HomePage() {
  // =================
  // Auth
  // =================
  const session = await auth();
  if (!session?.user?.id) redirect('/auth');

  // Read status/role straight from the DB rather than the JWT. A freshly
  // onboarded (pending_approval) or freshly approved (active) user still
  // carries a stale status in their token until it is refreshed, which would
  // otherwise bounce them back to /onboarding from this routing hub.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { status: true, role: true },
  });

  switch (user?.status) {
    case 'active':
      redirect(getCanSeeBudgetAndReports(user.role) ? '/dashboard' : '/order');
    case 'pending_approval':
      redirect('/waiting');
    case 'pending_onboarding':
      redirect('/onboarding');
    case 'rejected':
      redirect('/rejected');
    default:
      redirect('/auth');
  }
}
