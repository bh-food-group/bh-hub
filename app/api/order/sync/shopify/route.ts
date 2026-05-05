/**
 * POST /api/order/sync/shopify — Manual Shopify order sync (session auth).
 * GET  /api/order/sync/shopify — Cron-triggered sync (Bearer CRON_SECRET).
 *
 * Query params:
 *   ?mode=full  — Re-fetch orders (all pages) then sync the full customer directory
 *                 from Shopify (addresses + profile). Use once to backfill locals.
 *   (default)   — Incremental: orders updated since latest syncedAt + customers
 *                 updated in Shopify in the same window.
 *   ?stream=1   — With `mode=full`, stream NDJSON progress lines (see OfficeDataSyncClient).
 *
 * Client disconnect aborts the sync when `stream=1` (uses `request.signal`).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { isShopifyAdminEnvConfigured } from '@/lib/shopify/env';
import {
  executeShopifySync,
  type ShopifySyncMode,
  type ShopifySyncProgress,
} from '@/lib/shopify/sync/run-shopify-sync';

async function runSyncJson(mode: ShopifySyncMode, signal?: AbortSignal) {
  if (!isShopifyAdminEnvConfigured()) {
    return NextResponse.json(
      { error: 'Shopify credentials not configured' },
      { status: 503 },
    );
  }

  try {
    const result = await executeShopifySync(mode, { signal });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[sync/shopify] Error:', err);
    if (err instanceof DOMException && err.name === 'AbortError') {
      return NextResponse.json(
        { ok: false, aborted: true, error: 'Sync aborted' },
        { status: 499 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Sync failed', detail: message },
      { status: 500 },
    );
  }
}

// ─── GET: Vercel cron (Bearer CRON_SECRET) ───────────────────────────────────

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return runSyncJson('incremental');
}

// ─── POST: UI-triggered manual sync (session auth) ──────────────────────────

export async function POST(request: NextRequest) {
  const gate = await requireOrderManager();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const mode: ShopifySyncMode =
    url.searchParams.get('mode') === 'full' ? 'full' : 'incremental';
  const wantsStream = url.searchParams.get('stream') === '1';

  if (!isShopifyAdminEnvConfigured()) {
    return NextResponse.json(
      { error: 'Shopify credentials not configured' },
      { status: 503 },
    );
  }

  if (mode === 'full' && wantsStream) {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        };
        try {
          const result = await executeShopifySync('full', {
            signal: request.signal,
            onProgress: async (p: ShopifySyncProgress) => {
              send({ event: 'progress', ...p });
            },
          });
          send({ event: 'done', ...result });
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            send({ event: 'aborted' });
          } else {
            send({ event: 'error', message: String(err) });
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  return runSyncJson(mode, request.signal);
}
