/**
 * POST /api/order/purchase-orders/import-csv
 *
 * Accepts multipart `file` (Shopify Auto Purchase Orders CSV). Upserts by `legacyExternalId`.
 *
 * Query: `stream=1` — NDJSON progress + final summary (client disconnect / AbortSignal stops
 * between PO transactions; already committed POs remain).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import {
  parsePurchaseOrdersCsvText,
  runPurchaseOrdersCsvImport,
} from '@/lib/order/purchase-orders-csv-import-core';

export async function POST(request: NextRequest) {
  const gate = await requireOrderManager();
  if (!gate.ok) return gate.response;

  const wantsStream = request.nextUrl.searchParams.get('stream') === '1';

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const buf = await file.text();
    const rows = parsePurchaseOrdersCsvText(buf);

    if (wantsStream) {
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        async start(controller) {
          const send = (obj: unknown) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
          };
          try {
            const result = await runPurchaseOrdersCsvImport({
              rows,
              signal: request.signal,
              onProgress: async (p) => {
                send({ event: 'progress', ...p });
              },
            });
            send({ event: 'done', ...result });
          } catch (err) {
            send({ event: 'error', message: String(err) });
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

    const result = await runPurchaseOrdersCsvImport({ rows });
    return NextResponse.json({
      ok: true,
      totalCsvRows: result.totalCsvRows,
      purchaseOrders: result.purchaseOrders,
      created: result.created,
      updated: result.updated,
      aborted: result.aborted,
    });
  } catch (err) {
    console.error('[import-csv] Error:', err);
    return NextResponse.json(
      { error: 'Import failed', detail: String(err) },
      { status: 500 },
    );
  }
}
