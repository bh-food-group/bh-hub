'use client';

import { useState } from 'react';
import { ExternalLink, Mail, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatVancouverOrderedSidebar } from '../utils/vancouver-datetime';
import { postSendPurchaseOrderEmail } from '../utils/post-send-po-email';
import type { SupplierEntry, PoEmailDeliveryItem } from '../types';

type Props = {
  entry: SupplierEntry;
  /** PO created and not on draft-only selection: show send + per-recipient email UI. */
  includePoEmailTools?: boolean;
  /** Selected PO outbound email timestamp (ISO) when recorded. */
  poEmailSentAt?: string | null;
  /** Selected PO still needs a logged supplier email under the office policy. */
  poEmailDeliveryOutstanding?: boolean;
  /** ISO — user waived hub email reminders for this PO. */
  poEmailDeliveryWaivedAt?: string | null;
  /** Selected PO id for send-email API (omit when drafts or none). */
  selectedPoBlockId?: string | null;
  /** Per-recipient delivery records for the selected PO. */
  emailDeliveries?: PoEmailDeliveryItem[];
  onPoEmailSent?: (poId: string) => void;
  onSendEmailComplete?: () => void;
  onPoEmailDeliveryWaivedChange?: (
    poId: string,
    waived: boolean,
  ) => void | Promise<void>;
  /** Line items are being lazy-loaded — disable email send. */
  lineItemsLoading?: boolean;
  /** ISO timestamp when supplier reply was manually marked as received. */
  poEmailReplyReceivedAt?: string | null;
  /** Internal PO note from purchase order comment. */
  poInternalNote?: string | null;
  onReplyReceivedChange?: () => void;
};


function InstructionsBox({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2.5">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
        {title}
      </div>
      <div className="text-[11px] text-muted-foreground leading-relaxed space-y-1.5">
        {children}
      </div>
    </div>
  );
}

export function OrderProcessingBlock({
  entry,
  includePoEmailTools = true,
  poEmailSentAt = null,
  poEmailDeliveryOutstanding = false,
  poEmailDeliveryWaivedAt = null,
  selectedPoBlockId = null,
  emailDeliveries = [],
  onPoEmailSent,
  onSendEmailComplete,
  onPoEmailDeliveryWaivedChange,
  lineItemsLoading = false,
  poEmailReplyReceivedAt = null,
  poInternalNote = null,
  onReplyReceivedChange,
}: Props) {
  const t = entry.supplierOrderChannelType;
  const contacts = entry.supplierPoContacts;
  const ccEmails = entry.supplierPoCcEmails ?? [];
  const savedInstruction = entry.supplierOrderInstruction?.trim() ?? '';
  const [sendingEmail, setSendingEmail] = useState(false);
  const [waivingEmail, setWaivingEmail] = useState(false);
  const [togglingReply, setTogglingReply] = useState(false);
  const internalNote = poInternalNote?.trim() ?? '';

  const deliveryByEmail = new Map(emailDeliveries.map((d) => [d.recipientEmail.toLowerCase(), d]));

  const performSendEmail = async () => {
    if (
      !selectedPoBlockId ||
      selectedPoBlockId === '__drafts__' ||
      contacts.length === 0
    ) {
      return;
    }
    setSendingEmail(true);
    try {
      const result = await postSendPurchaseOrderEmail(selectedPoBlockId);
      if (!result.ok) {
        return;
      }
      onPoEmailSent?.(selectedPoBlockId);
      onSendEmailComplete?.();
    } catch {
      toast.error('Network error — could not send email');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleDoNotSendEmail = async () => {
    if (
      !selectedPoBlockId ||
      selectedPoBlockId === '__drafts__' ||
      !onPoEmailDeliveryWaivedChange
    ) {
      return;
    }
    setWaivingEmail(true);
    try {
      await onPoEmailDeliveryWaivedChange(selectedPoBlockId, true);
    } finally {
      setWaivingEmail(false);
    }
  };

  const handleUndoEmailWaive = async () => {
    if (
      !selectedPoBlockId ||
      selectedPoBlockId === '__drafts__' ||
      !onPoEmailDeliveryWaivedChange
    ) {
      return;
    }
    setWaivingEmail(true);
    try {
      await onPoEmailDeliveryWaivedChange(selectedPoBlockId, false);
    } finally {
      setWaivingEmail(false);
    }
  };

  const handleSendEmailClick = () => {
    if (
      !selectedPoBlockId ||
      selectedPoBlockId === '__drafts__' ||
      contacts.length === 0
    ) {
      return;
    }
    if (poEmailSentAt) {
      toast('Resend PO email to all contacts?', {
        description:
          'The same PO PDF will be emailed again to every address on file for this supplier.',
        action: {
          label: 'Resend',
          onClick: () => {
            void performSendEmail();
          },
        },
        cancel: {
          label: 'Cancel',
          onClick: () => {},
        },
      });
      return;
    }
    void performSendEmail();
  };

  const handleToggleReplyReceived = async () => {
    if (!selectedPoBlockId || selectedPoBlockId === '__drafts__') return;
    setTogglingReply(true);
    try {
      const method = poEmailReplyReceivedAt ? 'DELETE' : 'PATCH';
      const res = await fetch(`/api/order/purchase-orders/${selectedPoBlockId}/reply-received`, { method });
      if (!res.ok) { toast.error('Could not update reply status'); return; }
      const body = await res.json() as { emailReplyReceivedAt: string | null };
      onReplyReceivedChange?.();
      toast.success(poEmailReplyReceivedAt ? 'Reply mark removed.' : 'Reply marked as received.');
    } catch {
      toast.error('Network error');
    } finally {
      setTogglingReply(false);
    }
  };

  return (
    <div className="flex-shrink-0 border-b bg-muted/15 px-4 py-3">
      <div
        className={
          t === 'email' && includePoEmailTools
            ? 'mb-2.5 flex items-start justify-between gap-3'
            : 'mb-2.5 flex items-start gap-2'
        }
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <div className="mt-0.5 shrink-0 rounded-md border bg-background p-1 text-muted-foreground">
            <Mail className="size-3.5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-medium text-foreground leading-tight">
              Order processing
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
              {t === 'email' && includePoEmailTools ? (
                <>
                  One outbound message to every address on file for this supplier.
                  {poEmailSentAt ? (
                    <>
                      {' '}
                      Last send logged{' '}
                      <span className="font-medium text-foreground/80">
                        {formatVancouverOrderedSidebar(poEmailSentAt)}
                      </span>
                      .
                    </>
                  ) : poEmailDeliveryWaivedAt ? (
                    <>
                      {' '}
                      <span className="font-medium text-muted-foreground">
                        Marked not to send from the hub.
                      </span>
                    </>
                  ) : poEmailDeliveryOutstanding ? (
                    <>
                      {' '}
                      <span className="font-medium text-destructive">
                        No send logged for this PO yet.
                      </span>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  How to place this PO with the supplier. Delivery states below are
                  preview UI only.
                </>
              )}
            </p>
          </div>
        </div>
        {t === 'email' && includePoEmailTools ? (
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {poEmailSentAt ? (
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0 text-[11px] rounded-md gap-1.5 bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-800 dark:hover:bg-emerald-950/60"
                variant="outline"
                disabled={
                  contacts.length === 0 ||
                  !selectedPoBlockId ||
                  selectedPoBlockId === '__drafts__' ||
                  sendingEmail ||
                  lineItemsLoading
                }
                onClick={() => handleSendEmailClick()}
              >
                <Mail className="size-3.5" aria-hidden />
                {sendingEmail ? 'Sending…' : 'Email sent - resend?'}
              </Button>
            ) : poEmailDeliveryWaivedAt ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 text-[11px] rounded-md gap-1.5"
                disabled={
                  !selectedPoBlockId ||
                  selectedPoBlockId === '__drafts__' ||
                  waivingEmail ||
                  lineItemsLoading ||
                  !onPoEmailDeliveryWaivedChange
                }
                onClick={() => void handleUndoEmailWaive()}
              >
                {waivingEmail ? 'Updating…' : 'Undo not sending'}
              </Button>
            ) : (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0 text-[11px] rounded-md gap-1.5 border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white dark:border-emerald-500"
                    variant="outline"
                    disabled={
                      contacts.length === 0 ||
                      !selectedPoBlockId ||
                      selectedPoBlockId === '__drafts__' ||
                      sendingEmail ||
                      lineItemsLoading
                    }
                    onClick={() => handleSendEmailClick()}
                  >
                    <Mail className="size-3.5" aria-hidden />
                    {sendingEmail ? 'Sending…' : 'Send email'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 text-[11px] rounded-md px-2.5 text-muted-foreground"
                    disabled={
                      !selectedPoBlockId ||
                      selectedPoBlockId === '__drafts__' ||
                      waivingEmail ||
                      lineItemsLoading ||
                      !onPoEmailDeliveryWaivedChange
                    }
                    onClick={() => void handleDoNotSendEmail()}
                  >
                    {waivingEmail ? '…' : 'Do not send'}
                  </Button>
                </div>
              </div>
            )}
            {poEmailSentAt ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={
                  poEmailReplyReceivedAt
                    ? 'h-7 shrink-0 text-[10px] rounded-md gap-1 bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-100 dark:border-blue-800'
                    : 'h-7 shrink-0 text-[10px] rounded-md gap-1 text-muted-foreground'
                }
                disabled={togglingReply || !selectedPoBlockId || selectedPoBlockId === '__drafts__'}
                onClick={handleToggleReplyReceived}
              >
                <MailCheck className="size-3" aria-hidden />
                {poEmailReplyReceivedAt
                  ? `Reply received ${formatVancouverOrderedSidebar(poEmailReplyReceivedAt)}`
                  : 'Mark reply received'}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {internalNote ? (
        <div className="mb-2.5 rounded-md border bg-background px-3 py-2.5">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Notes (internal)
          </div>
          <p className="text-[11px] text-foreground leading-relaxed whitespace-pre-wrap break-words">
            {internalNote}
          </p>
        </div>
      ) : null}

      {t === 'email' ? (
        <div className="flex flex-col gap-2.5">
          {savedInstruction ? (
            <InstructionsBox title="Instructions">
              <p className="whitespace-pre-wrap">{savedInstruction}</p>
            </InstructionsBox>
          ) : null}

          {includePoEmailTools ? (
            <div className="rounded-md border bg-background">
              <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/25">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Per-email delivery
                </span>
                <div className="text-right">
                  <div className="text-[10px] text-muted-foreground">
                    {contacts.length} recipient{contacts.length === 1 ? '' : 's'}
                  </div>
                  {ccEmails.length > 0 ? (
                    <div className="text-[9px] text-muted-foreground">
                      CC: {ccEmails.join(', ')}
                    </div>
                  ) : null}
                </div>
              </div>
              {contacts.length === 0 ? (
                <div className="px-3 py-3 text-[11px] text-muted-foreground">
                  No PO email contacts on file. Add addresses in supplier settings
                  to send from the hub.
                </div>
              ) : (
                <ul className="divide-y">
                  {contacts.map((c, i) => {
                    const delivery = deliveryByEmail.get(c.email.toLowerCase());
                    const label = [c.name?.trim(), c.email]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <li
                        key={`${c.email}-${i}`}
                        className="flex items-center justify-between gap-2 px-3 py-2"
                      >
                        <span className="min-w-0 text-[11px] text-foreground truncate">
                          {label}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {delivery ? (
                            <span className="text-[9px] text-muted-foreground">
                              Sent {formatVancouverOrderedSidebar(delivery.sentAt)}
                            </span>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="rounded px-1.5 text-[9px]"
                            >
                              Not sent
                            </Badge>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : t === 'order_link' ? (
        <div className="flex flex-col gap-2.5">
          {savedInstruction ? (
            <InstructionsBox title="Instructions">
              <p className="whitespace-pre-wrap">{savedInstruction}</p>
            </InstructionsBox>
          ) : null}
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Order link
              </div>
              {entry.supplierOrderUrl ? (
                <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" asChild>
                  <a
                    href={entry.supplierOrderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="size-3" aria-hidden />
                    Open in new tab
                  </a>
                </Button>
              ) : null}
            </div>
            {entry.supplierOrderUrl ? (
              <a
                href={entry.supplierOrderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-blue-600 hover:underline break-all"
              >
                {entry.supplierOrderUrl}
              </a>
            ) : (
              <span className="text-[11px] text-muted-foreground">—</span>
            )}
          </div>
          {entry.supplierInvoiceConfirmSenderEmail ? (
            <p className="text-[10px] text-muted-foreground">
              Invoice confirmations expected from{' '}
              <span className="font-mono text-foreground/90">
                {entry.supplierInvoiceConfirmSenderEmail}
              </span>
              .
            </p>
          ) : null}
        </div>
      ) : (
        savedInstruction && (
          <div className="flex flex-col gap-2.5">
            <InstructionsBox title="Instructions">
              <p className="whitespace-pre-wrap">{savedInstruction}</p>
            </InstructionsBox>
          </div>
        )
      )}
    </div>
  );
}
