'use client';

import { toast } from 'sonner';

export type PostSendPoEmailOk = { ok: true; recipientCount: number };
export type PostSendPoEmailErr = { ok: false; error: string; status: number };
export type PostSendPoEmailResult = PostSendPoEmailOk | PostSendPoEmailErr;

const PO_EMAIL_PROGRESS_TOAST_PREFIX = 'po-email-progress-';

function poEmailProgressToastId(purchaseOrderId: string): string {
  return `${PO_EMAIL_PROGRESS_TOAST_PREFIX}${purchaseOrderId}`;
}

function emailSentAtChanged(
  baseline: string | null,
  next: string | null | undefined,
): boolean {
  if (next == null || next === '') return false;
  if (baseline == null) return true;
  return next !== baseline;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type QueuedBody = {
  ok?: boolean;
  queued?: boolean;
  baselineEmailSentAt?: string | null;
  recipientCount?: number;
  poNumber?: string;
};

type PoGetBody = {
  officeBlock?: {
    panelMeta?: {
      emailSentAt?: string | null;
      emailDeliveries?: { recipientEmail: string }[];
    } | null;
  };
};

const POLL_INTERVAL_MS = 1_200;
const POLL_TIMEOUT_MS = 120_000;

async function waitForQueuedPoEmailSend(args: {
  purchaseOrderId: string;
  baselineEmailSentAt: string | null;
  recipientCountHint: number;
  poNumberLabel: string;
}): Promise<PostSendPoEmailResult> {
  const toastId = poEmailProgressToastId(args.purchaseOrderId);
  toast.loading(`Sending PO ${args.poNumberLabel} email…`, {
    id: toastId,
    position: 'bottom-right',
    duration: Number.POSITIVE_INFINITY,
  });

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const pr = await fetch(`/api/order/purchase-orders/${args.purchaseOrderId}`);
      const pj = (await pr.json().catch(() => ({}))) as PoGetBody;
      const nextSent = pj?.officeBlock?.panelMeta?.emailSentAt ?? null;
      if (emailSentAtChanged(args.baselineEmailSentAt, nextSent)) {
        toast.dismiss(toastId);
        const fromBlock =
          pj?.officeBlock?.panelMeta?.emailDeliveries?.length ?? 0;
        const recipientCount =
          args.recipientCountHint > 0
            ? args.recipientCountHint
            : fromBlock > 0
              ? fromBlock
              : 0;
        if (recipientCount > 0) {
          toast.success(
            `Email sent to ${recipientCount} contact${recipientCount === 1 ? '' : 's'}.`,
            { position: 'bottom-right' },
          );
        } else {
          toast.success('PO email sent.', { position: 'bottom-right' });
        }
        return { ok: true, recipientCount };
      }
    }
    toast.dismiss(toastId);
    const msg = 'Timed out waiting for the email send to finish.';
    toast.error(msg, { position: 'bottom-right' });
    return { ok: false, error: msg, status: 504 };
  } catch {
    toast.dismiss(toastId);
    const msg = 'Network error while checking send status';
    toast.error(msg, { position: 'bottom-right' });
    return { ok: false, error: msg, status: 0 };
  }
}

export async function postSendPurchaseOrderEmail(
  purchaseOrderId: string,
): Promise<PostSendPoEmailResult> {
  let res: Response;
  try {
    res = await fetch(`/api/order/purchase-orders/${purchaseOrderId}/send-email`, {
      method: 'POST',
    });
  } catch {
    const msg = 'Network error — could not send email';
    toast.error(msg, { position: 'bottom-right' });
    return { ok: false, error: msg, status: 0 };
  }
  const body = (await res.json().catch(() => ({}))) as QueuedBody & {
    error?: string;
    recipientCount?: number;
  };

  if (!res.ok) {
    const err =
      typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    toast.error(err, { position: 'bottom-right' });
    return { ok: false, error: err, status: res.status };
  }

  if (res.status === 202 && body.queued && body.ok) {
    const baseline =
      body.baselineEmailSentAt === undefined
        ? null
        : (body.baselineEmailSentAt as string | null);
    const recipientCountHint =
      typeof body.recipientCount === 'number' ? body.recipientCount : 0;
    const poNumberLabel =
      typeof body.poNumber === 'string' && body.poNumber.trim()
        ? `#${body.poNumber.trim()}`
        : '';
    return waitForQueuedPoEmailSend({
      purchaseOrderId,
      baselineEmailSentAt: baseline,
      recipientCountHint,
      poNumberLabel,
    });
  }

  const msg = `Unexpected send-email response (HTTP ${res.status})`;
  toast.error(msg, { position: 'bottom-right' });
  return { ok: false, error: msg, status: res.status };
}
