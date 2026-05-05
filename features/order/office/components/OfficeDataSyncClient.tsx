'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

type SyncResult = {
  ok: boolean;
  mode?: 'incremental' | 'full';
  synced?: number;
  fetched?: number;
  since?: string | null;
  customersSynced?: number;
  customersFetched?: number;
  customerPagesFetched?: number;
  unmappedVendors?: string[];
  aborted?: boolean;
  error?: string;
  detail?: string;
};

type StreamProgress =
  | { phase: 'orders_fetch'; page: number; cumulativeOrders: number }
  | { phase: 'orders_process'; synced: number; total: number }
  | { phase: 'customers_fetch'; page: number; cumulativeCustomers: number }
  | { phase: 'customers_process'; synced: number; total: number }
  | { phase: 'vendors' };

function progressLabel(p: StreamProgress): string {
  switch (p.phase) {
    case 'orders_fetch':
      return `Fetching orders — page ${p.page} (${p.cumulativeOrders} loaded)`;
    case 'orders_process':
      return `Saving orders — ${p.synced} / ${p.total}`;
    case 'customers_fetch':
      return `Fetching customers — page ${p.page} (${p.cumulativeCustomers} loaded)`;
    case 'customers_process':
      return `Saving customers — ${p.synced} / ${p.total}`;
    case 'vendors':
      return 'Checking vendor mappings…';
    default:
      return 'Working…';
  }
}

function progressPercent(p: StreamProgress): number {
  switch (p.phase) {
    case 'orders_fetch':
      return Math.min(10, 2 + p.page * 2);
    case 'orders_process':
      return 10 + (p.total > 0 ? (p.synced / p.total) * 40 : 0);
    case 'customers_fetch':
      return 50 + Math.min(8, p.page * 2);
    case 'customers_process':
      return 58 + (p.total > 0 ? (p.synced / p.total) * 35 : 0);
    case 'vendors':
      return 96;
    default:
      return 0;
  }
}

type ImportResult = {
  ok: boolean;
  totalCsvRows?: number;
  purchaseOrders?: number;
  created?: number;
  updated?: number;
  aborted?: boolean;
  error?: string;
  detail?: string;
};

type ImportStreamProgress =
  | { phase: 'parsed'; totalRows: number; totalPo: number }
  | { phase: 'shopify_lookup'; shopifyOrderCount: number }
  | { phase: 'import_po'; done: number; total: number; legacyExternalId: number };

function importProgressLabel(p: ImportStreamProgress): string {
  switch (p.phase) {
    case 'parsed':
      return `Parsed CSV — ${p.totalPo} PO(s), ${p.totalRows} row(s)`;
    case 'shopify_lookup':
      return `Loaded ${p.shopifyOrderCount} Shopify order(s) for linking`;
    case 'import_po':
      return `Importing POs — ${p.done} / ${p.total} (export id ${p.legacyExternalId})`;
    default:
      return 'Working…';
  }
}

function importProgressPercent(p: ImportStreamProgress): number {
  switch (p.phase) {
    case 'parsed':
      return 5;
    case 'shopify_lookup':
      return 12;
    case 'import_po':
      return 12 + (p.total > 0 ? (p.done / p.total) * 88 : 0);
    default:
      return 0;
  }
}

export function OfficeDataSyncClient() {
  const router = useRouter();

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [liveProgress, setLiveProgress] = useState<StreamProgress | null>(null);

  const syncAbortRef = useRef<AbortController | null>(null);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importLiveProgress, setImportLiveProgress] = useState<ImportStreamProgress | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importAbortRef = useRef<AbortController | null>(null);

  const handleStopSync = useCallback(() => {
    syncAbortRef.current?.abort();
  }, []);

  const handleStopImport = useCallback(() => {
    importAbortRef.current?.abort();
  }, []);

  const handleFullSync = useCallback(async () => {
    if (
      !window.confirm(
        'Full sync may take several minutes. You can stop early; already processed data stays saved. Continue?',
      )
    ) {
      return;
    }
    const ac = new AbortController();
    syncAbortRef.current = ac;
    setSyncing(true);
    setSyncResult(null);
    setLiveProgress(null);
    try {
      const res = await fetch('/api/order/sync/shopify?mode=full&stream=1', {
        method: 'POST',
        signal: ac.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try {
          const j = JSON.parse(text) as { error?: string; detail?: string };
          const combined = [j.error, j.detail].filter(Boolean).join(': ');
          if (combined) msg = combined;
        } catch {
          /* use raw */
        }
        setSyncResult({ ok: false, error: msg || `HTTP ${res.status}` });
        return;
      }

      if (!res.body) {
        setSyncResult({ ok: false, error: 'No response body' });
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const finalRef = { current: null as SyncResult | null };

      const flushLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const msg = JSON.parse(trimmed) as Record<string, unknown> & { event?: string };
        const ev = msg.event;
        if (ev === 'progress') {
          const { event, ...rest } = msg as { event: string } & StreamProgress;
          void event;
          setLiveProgress(rest as StreamProgress);
        } else if (ev === 'done') {
          const { event, ...rest } = msg as { event: string } & Omit<SyncResult, 'ok'>;
          void event;
          finalRef.current = { ...(rest as SyncResult), ok: true };
          setLiveProgress(null);
        } else if (ev === 'aborted') {
          finalRef.current = {
            ok: false,
            error: 'Stopped. Partial progress may already be saved.',
          };
          setLiveProgress(null);
        } else if (ev === 'error') {
          finalRef.current = { ok: false, error: String(msg.message ?? 'Sync failed') };
          setLiveProgress(null);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
          flushLine(line);
        }
      }
      if (buf.trim()) {
        flushLine(buf);
      }

      const final = finalRef.current;
      if (final) {
        setSyncResult(final);
        if (final.ok) router.refresh();
      } else {
        setSyncResult({ ok: false, error: 'No completion message from server' });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setSyncResult({ ok: false, error: 'Stopped.' });
      } else {
        setSyncResult({ ok: false, error: String(err) });
      }
    } finally {
      setSyncing(false);
      syncAbortRef.current = null;
      setLiveProgress(null);
    }
  }, [router]);

  const handleImport = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    const ac = new AbortController();
    importAbortRef.current = ac;
    setImporting(true);
    setImportResult(null);
    setImportLiveProgress(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/order/purchase-orders/import-csv?stream=1', {
        method: 'POST',
        body: fd,
        signal: ac.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try {
          const j = JSON.parse(text) as { error?: string; detail?: string };
          const combined = [j.error, j.detail].filter(Boolean).join(': ');
          if (combined) msg = combined;
        } catch {
          /* use raw */
        }
        setImportResult({ ok: false, error: msg || `HTTP ${res.status}` });
        return;
      }

      if (!res.body) {
        setImportResult({ ok: false, error: 'No response body' });
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const finalRef = { current: null as ImportResult | null };

      const flushLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const msg = JSON.parse(trimmed) as Record<string, unknown> & { event?: string };
        const ev = msg.event;
        if (ev === 'progress') {
          const { event, ...rest } = msg as { event: string } & ImportStreamProgress;
          void event;
          setImportLiveProgress(rest as ImportStreamProgress);
        } else if (ev === 'done') {
          const { event, ...rest } = msg as {
            event: string;
            ok?: boolean;
            totalCsvRows?: number;
            purchaseOrders?: number;
            created?: number;
            updated?: number;
            aborted?: boolean;
          };
          void event;
          finalRef.current = {
            ok: rest.ok !== false,
            totalCsvRows: rest.totalCsvRows,
            purchaseOrders: rest.purchaseOrders,
            created: rest.created,
            updated: rest.updated,
            aborted: rest.aborted,
          };
          setImportLiveProgress(null);
        } else if (ev === 'error') {
          finalRef.current = { ok: false, error: String(msg.message ?? 'Import failed') };
          setImportLiveProgress(null);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
          flushLine(line);
        }
      }
      if (buf.trim()) {
        flushLine(buf);
      }

      const final = finalRef.current;
      if (final) {
        setImportResult(final);
        if (final.ok) router.refresh();
      } else {
        setImportResult({ ok: false, error: 'No completion message from server' });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setImportResult({ ok: false, error: 'Stopped.' });
      } else {
        setImportResult({ ok: false, error: String(err) });
      }
    } finally {
      setImporting(false);
      importAbortRef.current = null;
      setImportLiveProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [router]);

  const pct = liveProgress ? Math.round(progressPercent(liveProgress)) : 0;
  const importPct = importLiveProgress
    ? Math.round(importProgressPercent(importLiveProgress))
    : 0;

  return (
    <div className="space-y-6">
      {/* Full Shopify Order Sync */}
      <section className="rounded-lg border p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Full Shopify Sync</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Re-fetch all orders, then import every Shopify customer (default or first
            saved address) so local customer addresses backfill. Use for initial setup
            or when addresses look empty after incremental-only sync.
            <br />
            <span className="text-amber-600">
              For incremental sync, use the refresh icon in the top bar.
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            size="sm"
            variant="destructive"
            disabled={syncing}
            onClick={handleFullSync}
            className="text-xs"
          >
            {syncing ? 'Syncing…' : 'Run Full Sync'}
          </Button>
          {syncing && (
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={handleStopSync}
              className="text-xs"
            >
              Stop
            </Button>
          )}
        </div>
        {syncing && liveProgress && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">{progressLabel(liveProgress)}</p>
            <progress
              className="w-full h-2 rounded overflow-hidden [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
              value={pct}
              max={100}
            />
            <p className="text-[10px] text-muted-foreground tabular-nums">{pct}%</p>
          </div>
        )}
        {syncing && !liveProgress && (
          <p className="text-[11px] text-muted-foreground">Starting…</p>
        )}
        {syncResult && (
          <div
            className={`text-xs rounded px-2 py-1.5 ${
              syncResult.ok ? 'text-green-700 bg-green-50' : 'text-red-600 bg-red-50'
            }`}
            role={syncResult.ok ? undefined : 'alert'}
          >
            {syncResult.ok ? (
              syncResult.aborted ? (
                `Sync stopped partway — ${syncResult.synced ?? 0} order(s) saved; ${syncResult.customersSynced ?? 0} customer row(s).`
              ) : (
                `Full sync complete — ${syncResult.synced ?? 0} order(s), ${syncResult.fetched ?? 0} fetched; ${syncResult.customersSynced ?? 0} customer row(s) from directory (${syncResult.customersFetched ?? 0} fetched).`
              )
            ) : (
              <div className="space-y-1">
                <div>{syncResult.error ?? 'Failed'}</div>
                {syncResult.detail ? (
                  <div className="text-[10px] leading-snug break-words opacity-95">
                    {syncResult.detail}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
        {syncResult?.unmappedVendors && syncResult.unmappedVendors.length > 0 && (
          <div className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1.5">
            {syncResult.unmappedVendors.length} unmapped vendor(s):{' '}
            {syncResult.unmappedVendors.join(', ')}
          </div>
        )}
      </section>

      {/* PO CSV Import */}
      <section className="rounded-lg border p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Import Purchase Orders (CSV)</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload a Shopify Auto Purchase Orders CSV export. Existing POs
            (matched by legacy ID) will be updated; new ones will be created.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            disabled={importing}
            className="text-xs file:mr-2 file:rounded file:border file:border-border file:bg-background file:px-2.5 file:py-1 file:text-xs file:font-medium hover:file:bg-muted"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={importing}
            onClick={handleImport}
            className="text-xs"
          >
            {importing ? 'Importing…' : 'Import CSV'}
          </Button>
          {importing && (
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={handleStopImport}
              className="text-xs"
            >
              Stop
            </Button>
          )}
        </div>
        {importing && importLiveProgress && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              {importProgressLabel(importLiveProgress)}
            </p>
            <progress
              className="w-full h-2 rounded overflow-hidden [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
              value={importPct}
              max={100}
            />
            <p className="text-[10px] text-muted-foreground tabular-nums">{importPct}%</p>
          </div>
        )}
        {importing && !importLiveProgress && (
          <p className="text-[11px] text-muted-foreground">Starting import…</p>
        )}
        {importResult && (
          <div
            className={`text-xs rounded px-2 py-1.5 ${
              importResult.ok
                ? importResult.aborted
                  ? 'text-amber-800 bg-amber-50'
                  : 'text-green-700 bg-green-50'
                : 'text-red-600 bg-red-50'
            }`}
          >
            {importResult.ok ? (
              importResult.aborted ? (
                <span>
                  Import stopped — {importResult.created ?? 0} created, {importResult.updated ?? 0}{' '}
                  updated before stop ({importResult.totalCsvRows} CSV rows,{' '}
                  {importResult.purchaseOrders} PO groups).
                </span>
              ) : (
                `${importResult.purchaseOrders} POs processed — ${importResult.created} created, ${importResult.updated} updated (${importResult.totalCsvRows} CSV rows)`
              )
            ) : (
              importResult.error ?? 'Import failed'
            )}
          </div>
        )}
      </section>
    </div>
  );
}
