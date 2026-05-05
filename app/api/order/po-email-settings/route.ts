import { NextRequest, NextResponse } from 'next/server';
import { requireOrderManager } from '@/lib/api/require-order-manager';
import { prisma } from '@/lib/core/prisma';
import { toApiErrorResponse } from '@/lib/core/errors';
import {
  getPoEmailOutboundSettings,
  savePoEmailOutboundSettings,
  type PoEmailOutboundSettings,
} from '@/lib/order/po-email-settings';
import { buildPoEmailTransportMeta } from '@/lib/order/po-email-transport-meta';

function jsonWithTransport(settings: PoEmailOutboundSettings) {
  return {
    ...settings,
    transport: buildPoEmailTransportMeta(settings),
  };
}

function parseBody(body: unknown): PoEmailOutboundSettings | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === 'string' ? o[k] : null);
  const senderName = str('senderName');
  const subjectTemplate = str('subjectTemplate');
  const bodyIntroTemplate = str('bodyIntroTemplate');
  const bodySignatureTemplate =
    typeof o.bodySignatureTemplate === 'string' ? o.bodySignatureTemplate : null;
  if (
    !senderName?.trim() ||
    subjectTemplate === null ||
    bodyIntroTemplate === null ||
    bodySignatureTemplate === null ||
    !subjectTemplate.trim() ||
    !bodyIntroTemplate.trim()
  ) {
    return null;
  }
  const ccVal = o.ccEmail;
  const ccEmail =
    typeof ccVal === 'string' && ccVal.trim().length > 0 ? ccVal.trim() : null;
  return {
    senderName: senderName.trim(),
    ccEmail,
    subjectTemplate,
    bodyIntroTemplate,
    bodySignatureTemplate,
  };
}

export async function GET() {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;
    const settings = await getPoEmailOutboundSettings(prisma);
    return NextResponse.json(jsonWithTransport(settings));
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'GET /api/order/po-email-settings error:');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const gate = await requireOrderManager();
    if (!gate.ok) return gate.response;
    const json = (await request.json().catch(() => null)) as unknown;
    const parsed = parseBody(json);
    if (!parsed) {
      return NextResponse.json(
        {
          error:
            'Invalid body: senderName, non-empty subjectTemplate and bodyIntroTemplate, and bodySignatureTemplate (string, may be empty) required.',
        },
        { status: 400 },
      );
    }
    const saved = await savePoEmailOutboundSettings(prisma, parsed);
    return NextResponse.json(jsonWithTransport(saved));
  } catch (err: unknown) {
    return toApiErrorResponse(err, 'PUT /api/order/po-email-settings error:');
  }
}
