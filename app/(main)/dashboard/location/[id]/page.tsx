import LocationDashboardCards from '@/features/dashboard/location/components/LocationDashboardCards';
import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { getLocationById } from '@/lib/core/location-cache';
import { getCurrentYearMonth, isValidYearMonth } from '@/lib/utils';
import { notFound, redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const LocationPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ yearMonth?: string }>;
}) => {
  const [session, { id }] = await Promise.all([auth(), params]);
  const isOfficeOrAdmin = getOfficeOrAdmin(session?.user?.role);

  // Managers can only view their own location — redirect instead of 403.
  if (!isOfficeOrAdmin) {
    const managerLocationId = session?.user?.locationId;
    if (!managerLocationId) redirect('/dashboard');
    if (managerLocationId !== id) {
      const { yearMonth: sp } = await searchParams;
      const qs = sp ? `?yearMonth=${sp}` : '';
      redirect(`/dashboard/location/${managerLocationId}${qs}`);
    }
  }

  const location = await getLocationById(id);
  if (!location) return notFound();

  const { yearMonth: searchYearMonth } = await searchParams;
  const yearMonth = searchYearMonth ?? getCurrentYearMonth();
  if (!isValidYearMonth(yearMonth)) {
    redirect(`/dashboard/location/${id}?yearMonth=${getCurrentYearMonth()}`);
  }

  return <LocationDashboardCards />;
};

export default LocationPage;
