import {
  auth,
  getCanSeeBudgetAndReports,
  getCanSeeDeliveryAndCost,
  getCanSeeLabor,
  getOfficeOrAdmin,
} from '@/lib/auth';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import React from 'react';
import SignOutButton from '@/components/control/SignOutButton';
import HeaderNav from './HeaderNav';

type HeaderProps = {
  isOfficeOrAdmin?: boolean;
};

const Header = async ({ isOfficeOrAdmin }: HeaderProps) => {
  const session = await auth();
  if (!session?.user) redirect('/auth');

  const isActive = session.user.status === 'active';
  const isOfficeOrAdminFlag =
    isOfficeOrAdmin ?? getOfficeOrAdmin(session.user.role);
  const showBudgetAndReports = getCanSeeBudgetAndReports(session.user.role);
  const showDeliveryAndCost = getCanSeeDeliveryAndCost(session.user.role);
  const showLabor = getCanSeeLabor(session.user.role);

  return (
    isActive && (
      <header className="flex items-center justify-between gap-4 border-b pb-6 mb-5 flex-wrap md:flex-nowrap">
        <div className="shrink-0 flex items-center gap-6 md:w-full md:max-w-3xs">
          <div>
            <Link href={showBudgetAndReports ? '/dashboard' : '/order'}>
              <h1 className="text-xl font-semibold">BH Hub</h1>
            </Link>
            <p className="text-muted-foreground text-sm">
              {session.user.name ?? session.user.email}
              {session.user.role && (
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {session.user.role}
                </span>
              )}
              {session.user.locationCode && (
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {session.user.locationCode}
                </span>
              )}
            </p>
          </div>
        </div>
        <HeaderNav
          className="hidden md:flex w-full"
          role={session.user.role}
          showLabor={showLabor}
        />
        <div className="flex items-center gap-2">
          <SignOutButton size="sm" />
        </div>
        <HeaderNav
          className="md:hidden w-full"
          role={session.user.role}
          showLabor={showLabor}
        />
      </header>
    )
  );
};

export default Header;
