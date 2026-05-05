import nodemailer from 'nodemailer';
import type { PoPdfInput } from '@/features/order/office/utils/purchase-order-pdf';
import { buildPoPdfBuffer } from '@/features/order/office/utils/purchase-order-pdf';
import type { PoEmailOutboundSettings } from './po-email-settings';
import {
  buildPoEmailPlainBody,
  buildPoEmailSubject,
  resolvePoEmailFromAddress,
  resolvePoEmailPublicContactAddress,
} from './po-email-settings';
import {
  looseContactEmailsFromRaw,
  normalizeSupplierContactEmails,
} from './supplier-order-channel';

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  });
}

function buildTrackingPixelUrl(token: string): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/$/, '');
  if (!base) return null;
  return `${base}/api/order/track/email-open?t=${encodeURIComponent(token)}`;
}

function plainToHtml(plain: string): string {
  return plain
    .split('\n')
    .map((line) => {
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return escaped === '' ? '<br>' : `<p style="margin:0 0 4px 0">${escaped}</p>`;
    })
    .join('\n');
}

/** Office copy: BCC so supplier To-recipients do not share one visible Cc thread. */
function officeBccHeader(
  officeCcRaw: string | null | undefined,
  toEmailsLower: ReadonlySet<string>,
): string | undefined {
  const officePieces = officeCcRaw?.trim()
    ? looseContactEmailsFromRaw(officeCcRaw)
    : [];
  const normalized = normalizeSupplierContactEmails(officePieces).filter(
    (e) => !toEmailsLower.has(e.toLowerCase()),
  );
  if (normalized.length === 0) return undefined;
  return normalized.join(', ');
}

/** Supplier-configured Cc only; excludes To and other dedicated To-recipients. */
function supplierCcHeader(
  supplierCcEmails: string[],
  toEmailsLower: ReadonlySet<string>,
  dedicatedToRecipientsLower: ReadonlySet<string>,
): string | undefined {
  const normalized = normalizeSupplierContactEmails(supplierCcEmails).filter(
    (e) =>
      !toEmailsLower.has(e.toLowerCase()) &&
      !dedicatedToRecipientsLower.has(e.toLowerCase()),
  );
  if (normalized.length === 0) return undefined;
  return normalized.join(', ');
}

export async function sendPoEmail(args: {
  to: { email: string; name: string | null }[];
  supplierName: string;
  pdfInput: PoPdfInput;
  outbound: PoEmailOutboundSettings;
  trackingToken?: string;
  /** Pre-built PDF buffer — pass to avoid rebuilding for each recipient. */
  pdfBuffer?: Buffer;
  supplierCcEmails?: string[];
  /**
   * Emails that each get their own separate To-send in this PO batch (other primary contacts).
   * They are omitted from Cc so mail clients do not thread one conversation across recipients.
   */
  dedicatedToRecipientsLower?: ReadonlySet<string>;
}): Promise<void> {
  const { to, supplierName, pdfInput, outbound, trackingToken } = args;

  if (to.length === 0) return;

  if (to.length > 1) {
    if (trackingToken) {
      throw new Error(
        'sendPoEmail: use one To recipient when trackingToken is set, or call once per recipient.',
      );
    }
    const dedicated =
      args.dedicatedToRecipientsLower ??
      new Set(to.map((c) => c.email.toLowerCase()));
    for (const c of to) {
      await sendPoEmail({
        supplierName: args.supplierName,
        pdfInput: args.pdfInput,
        outbound: args.outbound,
        pdfBuffer: args.pdfBuffer,
        supplierCcEmails: args.supplierCcEmails,
        to: [c],
        dedicatedToRecipientsLower: dedicated,
      });
    }
    return;
  }

  const pdfBuffer = args.pdfBuffer ?? buildPoPdfBuffer(pdfInput);
  const plainBody = buildPoEmailPlainBody({ outbound, supplierName, poNumber: pdfInput.poNumber });
  const subject = buildPoEmailSubject(outbound, pdfInput.poNumber);

  const fromAddr = resolvePoEmailFromAddress();
  const publicContact = resolvePoEmailPublicContactAddress();
  const replyTo =
    publicContact && fromAddr.toLowerCase() !== publicContact.toLowerCase()
      ? publicContact
      : undefined;

  const pixelUrl = trackingToken ? buildTrackingPixelUrl(trackingToken) : null;
  const htmlBody = [
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">`,
    plainToHtml(plainBody),
    pixelUrl
      ? `<img src="${pixelUrl}" width="1" height="1" style="display:block;width:1px;height:1px;border:0" alt="" />`
      : '',
    `</div>`,
  ].join('\n');

  const transporter = createTransport();
  const toLower = new Set(to.map((c) => c.email.toLowerCase()));
  const dedicatedLower =
    args.dedicatedToRecipientsLower ?? toLower;
  const bcc = officeBccHeader(outbound.ccEmail, toLower);
  const cc = supplierCcHeader(args.supplierCcEmails ?? [], toLower, dedicatedLower);
  await transporter.sendMail({
    from: `${outbound.senderName} <${fromAddr}>`,
    ...(replyTo ? { replyTo } : {}),
    to: to.map((c) => (c.name ? `${c.name} <${c.email}>` : c.email)),
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    subject,
    text: plainBody,
    html: htmlBody,
    attachments: [
      {
        filename: `PO-${pdfInput.poNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}
