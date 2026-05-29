import OnboardingList from '@/features/onboard/components/OnboardingList';
import { RefreshTokenExpiredAlert } from '@/features/locations/components/RefreshTokenExpiredAlert';
import Header from '@/components/control/Header';
import { auth, getOfficeOrAdmin, requireActiveSession } from '@/lib/auth';
import { getPendingApprovals } from '@/features/onboard/utils/onboarding';
import { unstable_cache } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

const getCachedPendingApprovals = unstable_cache(
  getPendingApprovals,
  ['pending-approvals'],
  { revalidate: 60 },
);

const layout = async ({ children }: { children: ReactNode }) => {
  // =================
  // Auth
  // =================
  const session = await auth();
  if (!session?.user) redirect('/auth');
  if (!requireActiveSession(session)) redirect('/onboarding');

  // =================
  // Onboarding
  // =================
  const canApprove =
    session?.user?.role === 'admin' || session?.user?.role === 'office';
  const pending = canApprove ? await getCachedPendingApprovals() : [];

  const isOfficeOrAdmin = getOfficeOrAdmin(session?.user?.role);

  return (
    <div className="flex min-h-dvh flex-col w-full min-w-0 max-w-full p-4 md:p-8">
      <main className="flex-1 min-w-0">
        <Header isOfficeOrAdmin={isOfficeOrAdmin} />
        <div className="space-y-6">
          <RefreshTokenExpiredAlert
            isOfficeOrAdmin={isOfficeOrAdmin ?? false}
          />
          <OnboardingList canApprove={canApprove} pending={pending} />
          {children}
        </div>
      </main>
    </div>
  );
};

export default layout;
