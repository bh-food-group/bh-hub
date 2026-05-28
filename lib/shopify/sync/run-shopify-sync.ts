/**
 * Shared Shopify sync runner (orders + customers) for cron, JSON API, and NDJSON streaming.
 */

import { prisma } from '@/lib/core/prisma';
import {
  getShopifyAdminEnv,
  isShopifyAdminEnvConfigured,
} from '@/lib/shopify/env';
import { fetchAllShopifyCustomers } from '@/lib/shopify/fetchCustomers';
import { fetchAllShopifyOrders } from '@/lib/shopify/fetchOrders';
import { syncOneOrder, upsertShopifyCustomerFromAdminNode } from '@/lib/shopify/sync/upsert-order';
import { createShopifyAdminGraphqlClient } from '@/lib/shopify/createFulfillment';

const CONCURRENCY = 3;

export type ShopifySyncMode = 'incremental' | 'full';

export type ShopifySyncProgress =
  | { phase: 'orders_fetch'; page: number; cumulativeOrders: number }
  | { phase: 'orders_process'; synced: number; total: number }
  | { phase: 'customers_fetch'; page: number; cumulativeCustomers: number }
  | { phase: 'customers_process'; synced: number; total: number }
  | { phase: 'vendors' };

export type ShopifySyncResult = {
  ok: true;
  mode: ShopifySyncMode;
  synced: number;
  fetched: number;
  since: string | null;
  customersSynced: number;
  customersFetched: number;
  customerPagesFetched: number;
  unmappedVendors: string[];
  aborted?: boolean;
};

async function detectUnmappedVendors(): Promise<string[]> {
  const allVendors = await prisma.shopifyOrderLineItem.findMany({
    where: { vendor: { not: null } },
    select: { vendor: true },
    distinct: ['vendor'],
  });
  const mappings = await prisma.shopifyVendorMapping.findMany({
    select: { vendorName: true },
  });
  const mappedSet = new Set(mappings.map((m) => m.vendorName));
  const unmapped = allVendors
    .map((v) => v.vendor!)
    .filter((name) => !mappedSet.has(name));

  if (unmapped.length > 0) {
    console.log(
      `[sync/shopify] ${unmapped.length} unmapped vendor(s): ${unmapped.join(', ')}`,
    );
  }
  return unmapped;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException('Sync aborted', 'AbortError');
  }
}

async function processInBatches<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  options?: {
    signal?: AbortSignal;
    onBatchComplete?: (done: number, total: number) => void | Promise<void>;
  },
) {
  const signal = options?.signal;
  const onBatchComplete = options?.onBatchComplete;
  let done = 0;
  for (let i = 0; i < items.length; i += concurrency) {
    throwIfAborted(signal);
    const batch = items.slice(i, i + concurrency);
    await Promise.all(batch.map(fn));
    done += batch.length;
    await onBatchComplete?.(done, items.length);
  }
}

export type ExecuteShopifySyncOptions = {
  onProgress?: (p: ShopifySyncProgress) => void | Promise<void>;
  signal?: AbortSignal;
};

/**
 * Run order + customer sync. Respects `signal` between fetch pages and process batches.
 */
export async function executeShopifySync(
  mode: ShopifySyncMode,
  options: ExecuteShopifySyncOptions = {},
): Promise<ShopifySyncResult> {
  const { onProgress, signal } = options;

  if (!isShopifyAdminEnvConfigured()) {
    throw new Error('Shopify credentials not configured');
  }

  const creds = getShopifyAdminEnv();

  /** Lower bound for Shopify `updated_at:` search when mode is incremental (see below). */
  let since: Date | null = null;
  let query: string | undefined;

  if (mode === 'incremental') {
    const latestSync = await prisma.shopifyOrder.aggregate({
      _max: { syncedAt: true },
    });
    const maxSyncedAt = latestSync._max.syncedAt;
    if (maxSyncedAt) {
      /**
       * `syncedAt` is when **we** last wrote the row, not Shopify’s `updated_at`. Using
       * `_max(syncedAt)` alone as the search floor skips orders whose Shopify `updated_at`
       * never moved past that wall (e.g. never imported, or old orders). Pull an overlap
       * window so incremental runs still pick up stragglers; upserts dedupe.
       */
      const overlapMs = 48 * 60 * 60 * 1000;
      since = new Date(maxSyncedAt.getTime() - overlapMs);
      query = `updated_at:>'${since.toISOString()}'`;
      console.log(
        `[sync/shopify] incremental order search: ${query} (max local syncedAt=${maxSyncedAt.toISOString()}, overlap=48h)`,
      );
    } else {
      since = null;
      query = undefined;
      console.log('[sync/shopify] incremental: no local orders yet — fetching default Shopify order window');
    }
  }

  const maxPages = mode === 'full' ? 200 : 20;

  throwIfAborted(signal);

  const { orders, pagesFetched } = await fetchAllShopifyOrders(creds, {
    /** Keep pages small: bulk `orders` query cost scales with orders × line fields (Shopify max ~1000/query). */
    pageSize: mode === 'full' ? 40 : 35,
    maxPages,
    query,
    signal,
    onPage: async ({ pageIndex, cumulativeOrders }) => {
      await onProgress?.({
        phase: 'orders_fetch',
        page: pageIndex,
        cumulativeOrders,
      });
    },
  });

  console.log(
    `[sync/shopify] Fetched ${orders.length} orders across ${pagesFetched} page(s)` +
      (since ? ` (since ${since.toISOString()})` : ` (${mode})`),
  );

  const shopifyAdminClient = createShopifyAdminGraphqlClient(creds);
  let synced = 0;
  const totalOrders = orders.length;
  try {
    await processInBatches(
      orders,
      CONCURRENCY,
      async (order) => {
        await syncOneOrder(order, shopifyAdminClient);
        synced++;
      },
      {
        signal,
        onBatchComplete: async (done) => {
          await onProgress?.({ phase: 'orders_process', synced: done, total: totalOrders });
        },
      },
    );
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return {
        ok: true,
        mode,
        synced,
        fetched: totalOrders,
        since: since?.toISOString() ?? null,
        customersSynced: 0,
        customersFetched: 0,
        customerPagesFetched: 0,
        unmappedVendors: [],
        aborted: true,
      };
    }
    throw e;
  }

  let customersSynced = 0;
  let customerPagesFetched = 0;
  let customersFetched = 0;

  if (mode === 'incremental' && since) {
    throwIfAborted(signal);
    const customerQuery = `updated_at:>'${since.toISOString()}'`;
    const { customers, pagesFetched: cp } = await fetchAllShopifyCustomers(creds, {
      pageSize: 250,
      maxPages: 20,
      query: customerQuery,
      signal,
      onPage: async ({ pageIndex, cumulativeCustomers }) => {
        await onProgress?.({
          phase: 'customers_fetch',
          page: pageIndex,
          cumulativeCustomers,
        });
      },
    });
    customersFetched = customers.length;
    customerPagesFetched = cp;

    try {
      await processInBatches(
        customers,
        CONCURRENCY,
        async (c) => {
          await upsertShopifyCustomerFromAdminNode(c);
          customersSynced++;
        },
        {
          signal,
          onBatchComplete: async (done) => {
            await onProgress?.({
              phase: 'customers_process',
              synced: done,
              total: customers.length,
            });
          },
        },
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return {
          ok: true,
          mode,
          synced,
          fetched: totalOrders,
          since: since?.toISOString() ?? null,
          customersSynced,
          customersFetched,
          customerPagesFetched,
          unmappedVendors: [],
          aborted: true,
        };
      }
      throw e;
    }

    console.log(
      `[sync/shopify] Synced ${customersSynced} customer(s) across ${customerPagesFetched} customer page(s) (query: ${customerQuery})`,
    );
  }

  if (mode === 'full') {
    throwIfAborted(signal);
    const { customers: allCustomers, pagesFetched: cp } = await fetchAllShopifyCustomers(creds, {
      pageSize: 250,
      maxPages: 100,
      signal,
      onPage: async ({ pageIndex, cumulativeCustomers }) => {
        await onProgress?.({
          phase: 'customers_fetch',
          page: pageIndex,
          cumulativeCustomers,
        });
      },
    });
    customersFetched = allCustomers.length;
    customerPagesFetched = cp;

    try {
      await processInBatches(
        allCustomers,
        CONCURRENCY,
        async (c) => {
          await upsertShopifyCustomerFromAdminNode(c);
          customersSynced++;
        },
        {
          signal,
          onBatchComplete: async (done) => {
            await onProgress?.({
              phase: 'customers_process',
              synced: done,
              total: allCustomers.length,
            });
          },
        },
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return {
          ok: true,
          mode,
          synced,
          fetched: totalOrders,
          since: since?.toISOString() ?? null,
          customersSynced,
          customersFetched,
          customerPagesFetched,
          unmappedVendors: [],
          aborted: true,
        };
      }
      throw e;
    }

    console.log(
      `[sync/shopify] Full customer directory: ${customersSynced} row(s) across ${cp} page(s)`,
    );
  }

  throwIfAborted(signal);
  await onProgress?.({ phase: 'vendors' });
  const unmappedVendors = await detectUnmappedVendors();

  return {
    ok: true,
    mode,
    synced,
    fetched: totalOrders,
    since: since?.toISOString() ?? null,
    customersSynced,
    customersFetched,
    customerPagesFetched,
    unmappedVendors,
  };
}
