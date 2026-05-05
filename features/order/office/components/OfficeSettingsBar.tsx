'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

const OFFICE_BASE = '/order/office';

const SETTINGS_PREFIXES = [
  `${OFFICE_BASE}/supplier`,
  `${OFFICE_BASE}/customer-settings`,
  `${OFFICE_BASE}/contact-settings`,
  `${OFFICE_BASE}/item-settings`,
  `${OFFICE_BASE}/delivery-location-presets`,
  `${OFFICE_BASE}/settings`,
];

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M13.5 2.5v3.5h-3.5" />
      <path d="M2.5 8a5.5 5.5 0 0 1 9.37-3.9l1.63 1.4" />
      <path d="M2.5 13.5V10h3.5" />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.37 3.9L2.5 10.5" />
    </svg>
  );
}

function formatSyncTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function OfficeSettingsBar() {
  const pathname = usePathname();
  const router = useRouter();
  const isSuppliers = pathname.startsWith(`${OFFICE_BASE}/supplier`);
  const isCustomers = pathname.startsWith(`${OFFICE_BASE}/customer-settings`);
  const isContact = pathname.startsWith(`${OFFICE_BASE}/contact-settings`);
  const isItemSettings = pathname.startsWith(`${OFFICE_BASE}/item-settings`);
  const isDeliveryPresets = pathname.startsWith(
    `${OFFICE_BASE}/delivery-location-presets`,
  );
  const isDataSync = pathname.startsWith(`${OFFICE_BASE}/settings`);
  const isSettingsPage = SETTINGS_PREFIXES.some((p) => pathname.startsWith(p));

  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/order/sync/shopify/status');
      if (res.ok) {
        const json = await res.json();
        setLastSyncedAt(json.lastSyncedAt);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  /** Same layout stays mounted across office routes — clear stale sync errors when navigating. */
  useEffect(() => {
    setSyncError(null);
  }, [pathname]);

  const handleIncrementalSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch('/api/order/sync/shopify?mode=incremental', {
        method: 'POST',
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        const msg =
          [json.error, json.detail].filter(Boolean).join(': ') ||
          `HTTP ${res.status}`;
        setSyncError(msg);
        return;
      }
      if (json.ok) {
        await fetchStatus();
        router.refresh();
      } else {
        setSyncError(
          [json.error, json.detail].filter(Boolean).join(': ') || 'Sync failed',
        );
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [fetchStatus, router]);

  return (
    <div className="flex items-center justify-between mb-2 flex-wrap">
      {/* Left: sync status + refresh */}
      <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-1.5 min-w-0">
        {isSettingsPage && (
          <Link
            href={OFFICE_BASE}
            prefetch={false}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors mr-2"
          >
            &larr; Back
          </Link>
        )}
        <div className="flex flex-col gap-0.5 min-w-0">
          <button
            type="button"
            disabled={syncing}
            onClick={handleIncrementalSync}
            className={cn(
              'flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors',
              syncing && 'opacity-50 cursor-not-allowed',
            )}
            title="Incremental Sync"
          >
            <RefreshIcon className={cn('w-3 h-3', syncing && 'animate-spin')} />
            {lastSyncedAt ? (
              <span>Synced {formatSyncTime(lastSyncedAt)}</span>
            ) : (
              <span>{syncing ? 'Syncing…' : 'Sync'}</span>
            )}
          </button>
          {syncError && (
            <p
              className="text-[10px] text-destructive max-w-[min(100vw-2rem,28rem)] leading-snug break-words"
              role="alert"
            >
              {syncError}
            </p>
          )}
        </div>
      </div>

      {/* Right: settings tabs */}
      <div className="flex gap-1.5 flex-wrap">
        <Link
          href={`${OFFICE_BASE}/supplier`}
          prefetch={false}
          scroll={false}
          className={cn(
            buttonVariants({
              variant: isSuppliers ? 'default' : 'outline',
              size: 'xs',
            }),
            'text-[11px] rounded-[5px]',
            !isSuppliers && 'text-muted-foreground',
          )}
        >
          Supplier Settings
        </Link>
        <Link
          href={`${OFFICE_BASE}/customer-settings`}
          prefetch={false}
          scroll={false}
          className={cn(
            buttonVariants({
              variant: isCustomers ? 'default' : 'outline',
              size: 'xs',
            }),
            'text-[11px] rounded-[5px]',
            !isCustomers && 'text-muted-foreground',
          )}
        >
          Customer Settings
        </Link>
        <Link
          href={`${OFFICE_BASE}/contact-settings`}
          prefetch={false}
          scroll={false}
          className={cn(
            buttonVariants({
              variant: isContact ? 'default' : 'outline',
              size: 'xs',
            }),
            'text-[11px] rounded-[5px]',
            !isContact && 'text-muted-foreground',
          )}
        >
          Contact Settings
        </Link>
        <Link
          href={`${OFFICE_BASE}/item-settings`}
          prefetch={false}
          scroll={false}
          className={cn(
            buttonVariants({
              variant: isItemSettings ? 'default' : 'outline',
              size: 'xs',
            }),
            'text-[11px] rounded-[5px]',
            !isItemSettings && 'text-muted-foreground',
          )}
        >
          Item settings
        </Link>
        <Link
          href={`${OFFICE_BASE}/delivery-location-presets`}
          prefetch={false}
          scroll={false}
          className={cn(
            buttonVariants({
              variant: isDeliveryPresets ? 'default' : 'outline',
              size: 'xs',
            }),
            'text-[11px] rounded-[5px]',
            !isDeliveryPresets && 'text-muted-foreground',
          )}
        >
          Delivery locations
        </Link>
        <Link
          href={`${OFFICE_BASE}/settings`}
          prefetch={false}
          scroll={false}
          className={cn(
            buttonVariants({
              variant: isDataSync ? 'default' : 'outline',
              size: 'xs',
            }),
            'text-[11px] rounded-[5px]',
            !isDataSync && 'text-muted-foreground',
          )}
        >
          Data &amp; Sync
        </Link>
      </div>
    </div>
  );
}
