import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { parseBody, shopifyVariantOfficeNotePutSchema } from '@/lib/api/schemas';
import { toApiErrorResponse } from '@/lib/core/errors';
import { upsertShopifyVariantOfficeNote } from '@/lib/order/shopify-variant-office-note';

export async function GET() {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const rows = await prisma.shopifyVariantOfficeNote.findMany({
      select: { shopifyVariantGid: true, note: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({
      ok: true,
      notes: rows.map((r) => ({
        shopifyVariantGid: r.shopifyVariantGid,
        note: r.note,
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/shopify/variant-notes');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, shopifyVariantOfficeNotePutSchema);
    if ('error' in parsed) return parsed.error;
    const { data } = parsed;

    await upsertShopifyVariantOfficeNote(prisma, data.shopifyVariantGid, data.note);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'PUT /api/shopify/variant-notes');
  }
}
