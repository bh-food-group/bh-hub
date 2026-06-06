import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { prisma } from '@/lib/core';
import { getLocationById } from '@/lib/core/location-cache';
import { isLaborModuleEnabled } from '@/lib/labor/feature-flag';
import { LaborModule } from '@/features/labor/components/LaborModule';
import { notFound, redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Location-scoped Labor module shell. Enforces access server-side: location
 * users are redirected to their own location; office/admin may pick any and get
 * a location selector. The selected location (in the URL) drives every screen.
 */
const LaborLocationPage = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  if (!isLaborModuleEnabled()) notFound();

  const [session, { id }] = await Promise.all([auth(), params]);
  if (!session?.user) redirect('/auth');

  const role = session.user.role;
  const isOfficeOrAdmin = getOfficeOrAdmin(role);
  const canSeeLabor = isOfficeOrAdmin || role === 'manager';
  if (!canSeeLabor) notFound();

  // Location users are pinned to their own location.
  if (!isOfficeOrAdmin) {
    const own = session.user.locationId;
    if (!own) redirect('/');
    if (own !== id) redirect(`/labor/location/${own}`);
  }

  const location = await getLocationById(id);
  if (!location) return notFound();

  // Office/admin get a selector across all locations.
  const locations = isOfficeOrAdmin
    ? await prisma.location.findMany({
        orderBy: { createdAt: 'asc' },
        select: { id: true, code: true, name: true },
      })
    : [{ id: location.id, code: location.code, name: location.name }];

  return (
    <LaborModule
      locationId={id}
      locationName={location.name}
      role={role}
      isOfficeOrAdmin={isOfficeOrAdmin}
      locations={locations}
    />
  );
};

export default LaborLocationPage;
