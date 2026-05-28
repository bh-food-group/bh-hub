import { cn } from '@/lib/utils';
import { ClassName } from '@/types/className';
import type { UserRole } from '@/types/user';
import { PropsWithChildren } from 'react';
import HeaderNavItem from './HeaderNavItem';
import {
  getCanSeeBudgetAndReports,
  getCanSeeDeliveryAndCost,
  getCanSeeOrderSection,
  getOfficeOrAdmin,
} from '@/lib/auth';

const HeaderNav = ({
  className,
  role,
}: PropsWithChildren<
  ClassName & {
    role: UserRole | null;
  }
>) => {
  return (
    <nav
      className={cn(
        'flex items-center flex-wrap md:justify-between gap-2 md:gap-6',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {getCanSeeBudgetAndReports(role) && (
          <>
            <HeaderNavItem href="/dashboard">Dashboard</HeaderNavItem>
            <HeaderNavItem href="/report">Reports</HeaderNavItem>
          </>
        )}
        {getCanSeeOrderSection(role) && (
          <HeaderNavItem href="/order" prefetch={false}>Order</HeaderNavItem>
        )}
        {getCanSeeDeliveryAndCost(role) && (
          <>
            <HeaderNavItem href="/delivery">Delivery</HeaderNavItem>
            <HeaderNavItem href="/cost">Cost</HeaderNavItem>
          </>
        )}
      </div>
      {getOfficeOrAdmin(role) && (
        <div className="flex items-center gap-2">
          <HeaderNavItem href="/users">Users</HeaderNavItem>
          <HeaderNavItem href="/locations">Locations</HeaderNavItem>
        </div>
      )}
    </nav>
  );
};

export default HeaderNav;
