'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { RefreshCw, Link2, GitMerge } from 'lucide-react';

/** Match GET /api/realm response: realm list with QB connection status per realm. */
export type RealmWithConnection = {
  id: string;
  name: string;
  realmId: string;
  hasTokens: boolean;
  refreshExpiresAt: string | null;
  accessTokenExpired: boolean;
  refreshTokenExpired: boolean;
  locationCount: number;
  isOrphan?: boolean;
  mergeTargetId?: string;
};

type ManageRealmsDialogProps = {
  /** Realms with connection status from GET /api/realm. When provided, no fetch. */
  realms?: RealmWithConnection[];
  isAdmin?: boolean;
  /** Called when the dialog closes (e.g. so parent can refetch). */
  onOpenChange?: (open: boolean) => void;
  /** Called after refresh-token success so parent can refetch (e.g. router.refresh()). */
  onRealmsRefetch?: () => void;
  trigger?: React.ReactNode;
};

export function ManageRealmsDialog({
  realms: realmsProp,
  isAdmin: isAdminProp = false,
  onOpenChange,
  onRealmsRefetch,
  trigger,
}: ManageRealmsDialogProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [realmsState, setRealmsState] = useState<RealmWithConnection[]>([]);
  const [isAdminState, setIsAdminState] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [mergingId, setMergingId] = useState<string | null>(null);

  const useProps = realmsProp != null;
  const realms = useProps ? realmsProp : realmsState;
  const isAdmin = useProps ? isAdminProp : isAdminState;

  const handleOpenChange = useCallback(
    (value: boolean) => {
      setOpen(value);
      onOpenChange?.(value);
    },
    [onOpenChange],
  );

  const fetchFromRealm = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/realm');
      if (!res.ok) throw new Error('Failed to load realms');
      const data = await res.json();
      setRealmsState(data.realms ?? []);
      setIsAdminState(data.isAdmin ?? false);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Failed to load realms',
      );
      setRealmsState([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !useProps) fetchFromRealm();
  }, [open, useProps, fetchFromRealm]);

  /** Connect or Reconnect: OAuth without locationId (QB connection is per realm). */
  const handleConnect = useCallback(() => {
    const baseUrl =
      typeof window !== 'undefined'
        ? window.location.origin
        : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const returnTo = encodeURIComponent(pathname || '/locations');
    window.location.href = `${baseUrl}/api/quickbooks/auth?returnTo=${returnTo}`;
  }, [pathname]);

  const handleRefresh = useCallback(
    async (realmId: string) => {
      setRefreshingId(realmId);
      try {
        const res = await fetch('/api/quickbooks/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ realmId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error ?? 'Refresh failed');
        }
        toast.success('Tokens refreshed');
        if (useProps) {
          onRealmsRefetch?.();
        } else {
          await fetchFromRealm();
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Refresh failed');
      } finally {
        setRefreshingId(null);
      }
    },
    [useProps, onRealmsRefetch, fetchFromRealm],
  );

  const handleMerge = useCallback(
    async (orphanId: string, targetId: string) => {
      setMergingId(orphanId);
      try {
        const res = await fetch('/api/realm/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orphanId, targetId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? 'Merge failed');
        toast.success('Orphan realm merged and deleted');
        if (useProps) {
          onRealmsRefetch?.();
        } else {
          await fetchFromRealm();
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Merge failed');
      } finally {
        setMergingId(null);
      }
    },
    [useProps, onRealmsRefetch, fetchFromRealm],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            Manage Realms
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="flex-row items-center justify-between">
          <DialogTitle>Manage Realms</DialogTitle>
          <Button size="sm" onClick={handleConnect}>
            Connect New Realm
          </Button>
        </DialogHeader>
        {!useProps && loading ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-8" />
          </div>
        ) : realms.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">
            No realms. Add a location and assign a realm, or connect QuickBooks
            to add a new company.
          </p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-auto">
            {realms.map((realm) => {
              const showRefresh =
                realm.hasTokens &&
                (isAdmin ? !realm.refreshTokenExpired : realm.refreshTokenExpired);
              const showReconnect =
                realm.hasTokens && (isAdmin || realm.refreshTokenExpired);
              const hint = realm.hasTokens
                ? realm.refreshTokenExpired
                  ? 'Refresh token expired — reconnect to get new tokens.'
                  : realm.accessTokenExpired
                    ? 'Access token expired — refresh to get new access token.'
                    : 'Tokens valid.'
                : null;

              return (
                <div
                  key={realm.id}
                  className={`flex items-center justify-between gap-4 rounded-lg border p-3 ${realm.isOrphan ? 'border-amber-500/50 bg-amber-50/40 dark:bg-amber-950/20' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">
                        {realm.name || `Realm ${realm.realmId}`}
                      </p>
                      {realm.isOrphan && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                          Orphan
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {realm.isOrphan
                        ? 'No linked locations — duplicate from reconnect'
                        : realm.hasTokens ? (
                        realm.refreshExpiresAt ? (
                          <>
                            Connected · Refresh expires{' '}
                            {new Date(
                              realm.refreshExpiresAt,
                            ).toLocaleDateString()}
                          </>
                        ) : (
                          'Connected'
                        )
                      ) : (
                        'Not connected'
                      )}
                    </p>
                    {isAdmin && hint && !realm.isOrphan && (
                      <p
                        className={
                          realm.refreshTokenExpired
                            ? 'text-destructive text-xs mt-1'
                            : realm.accessTokenExpired
                              ? 'text-amber-600 dark:text-amber-500 text-xs mt-1'
                              : 'text-muted-foreground text-xs mt-1'
                        }
                      >
                        {hint}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {realm.isOrphan && realm.mergeTargetId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleMerge(realm.id, realm.mergeTargetId!)}
                        disabled={mergingId === realm.id}
                        className="border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-400"
                      >
                        {mergingId === realm.id ? (
                          <Spinner className="size-4" />
                        ) : (
                          <>
                            <GitMerge className="size-4 mr-1" />
                            Merge & Delete
                          </>
                        )}
                      </Button>
                    ) : realm.hasTokens ? (
                      <>
                        {showReconnect && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleConnect}
                            className={
                              realm.refreshTokenExpired
                                ? 'border-1 border-destructive ring-2 ring-destructive/20'
                                : ''
                            }
                          >
                            Reconnect
                          </Button>
                        )}
                        {showRefresh && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRefresh(realm.id)}
                            disabled={refreshingId === realm.id}
                            className={
                              realm.accessTokenExpired
                                ? 'border-1 border-amber-600 ring-2 ring-amber-600/20'
                                : ''
                            }
                          >
                            {refreshingId === realm.id ? (
                              <Spinner className="size-4" />
                            ) : (
                              <>
                                <RefreshCw className="size-4 mr-1" />
                                Refresh
                              </>
                            )}
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleConnect}
                      >
                        <Link2 className="size-4 mr-1" />
                        Connect QuickBooks
                      </Button>
                    )}
                  </div> {/* end buttons */}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
