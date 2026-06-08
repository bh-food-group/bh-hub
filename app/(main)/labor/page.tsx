import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { getDefaultDashboardLocationId } from '@/lib/dashboard/default-location';
import { notFound, redirect } from 'next/navigation';

/**
 * Entry to the Labor module. Resolves the location and redirects to the
 * location-scoped page, mirroring the dashboard's URL-path location scoping.
 * Location users land on their own location; office/admin on the default.
 */
const LaborPage = async () => {
  const session = await auth();
  const isOfficeOrAdmin = getOfficeOrAdmin(session?.user?.role);

  if (!isOfficeOrAdmin && session?.user?.locationId) {
    redirect(`/labor/location/${session.user.locationId}`);
  }

  const id = await getDefaultDashboardLocationId();
  if (!id) notFound();
  redirect(`/labor/location/${id}`);
};

export default LaborPage;
