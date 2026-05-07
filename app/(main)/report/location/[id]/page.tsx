import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { getConnections } from '@/lib/quickbooks/connections';
import { getReportsFromNotion } from '@/features/report/notion/reports';
import { ReportFormSection } from '@/features/report/components/ReportFormSection';
import { ReportTable } from '@/features/report/components/ReportTable';
import { redirect } from 'next/navigation';

export default async function ReportLocationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: locationId } = await params;

  const session = await auth();
  if (session?.user?.role === 'supply') redirect('/order');
  const isOfficeOrAdmin = getOfficeOrAdmin(session?.user?.role);

  // Managers can only view their own location — redirect instead of 403.
  if (!isOfficeOrAdmin) {
    const managerLocationId = session?.user?.locationId;
    if (!managerLocationId) redirect('/report');
    if (managerLocationId !== locationId) redirect(`/report/location/${managerLocationId}`);
  }

  const connections = await getConnections(session ?? null);
  const connection =
    connections.find((c) => c.locationId === locationId) ?? null;

  if (!locationId) {
    return (
      <div className="container max-w-5xl mx-auto py-6">
        <p className="text-muted-foreground">Invalid location.</p>
      </div>
    );
  }

  if (!connection) {
    return (
      <div className="container max-w-5xl mx-auto py-6">
        <p className="text-muted-foreground">Location not found.</p>
      </div>
    );
  }

  if (!connection.hasTokens) {
    return (
      <div className="container max-w-5xl mx-auto py-6">
        <p className="text-muted-foreground">
          QuickBooks is not connected for this location. Connect QuickBooks to
          generate P&L reports.
        </p>
      </div>
    );
  }

  const reports = session?.user?.id
    ? await getReportsFromNotion(session.user.id, connection.locationCode)
    : [];

  return (
    <div className="container max-w-5xl mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">P&L Reports</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {connection.locationCode ??
            connection.locationName ??
            connection.realmName}{' '}
          — Generate and view Profit & Loss reports. Reports are stored in
          Notion.
        </p>
      </div>

      <div className="space-y-4">
        <ReportFormSection
          locationCode={connection.locationCode}
          showForm={isOfficeOrAdmin ?? false}
        />
        <ReportTable reports={reports} isOfficeOrAdmin={isOfficeOrAdmin} />
      </div>
    </div>
  );
}
