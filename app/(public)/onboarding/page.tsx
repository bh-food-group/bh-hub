import SignOutButton from '@/components/control/SignOutButton';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { redirect } from 'next/navigation';
import { OnboardingForm } from '@/features/onboard/components/OnboardingForm';

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect('/auth');

  // No status guard here on purpose: routing decisions live solely in `/`
  // (app/page.tsx). Adding an opposite-condition redirect here would create a
  // `/` ↔ `/onboarding` loop whenever the two DB reads briefly disagree.
  // Re-submission by a non-pending_onboarding user is blocked in the POST
  // route instead (app/api/(public)/onboarding/route.ts).
  const locations = await prisma.location.findMany({
    orderBy: { createdAt: 'asc' },
  });

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 flex flex-col items-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Complete your profile</h1>
          <p className="mt-1 text-muted-foreground">
            Set your name, role, and location so we can personalize your
            experience.
          </p>
        </div>
        <OnboardingForm
          locations={locations}
          className="w-full"
          userName={session.user.name}
        />
        <SignOutButton variant="ghost" />
      </div>
    </div>
  );
}
