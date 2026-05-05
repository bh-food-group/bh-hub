'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import type { PoEmailDeliveryAlertItem } from '../utils/collect-po-email-delivery-alerts';
import { postSendPurchaseOrderEmail } from '../utils/post-send-po-email';

type Props = {
  items: PoEmailDeliveryAlertItem[];
  /** Row body: switch tab + focus this PO in the office layout. */
  onNavigateToPo: (item: PoEmailDeliveryAlertItem) => void;
  /** Called after successful send so the parent can patch view data before refresh. */
  onSent?: (purchaseOrderId: string) => void;
  /** Persist waive (true) or undo waive (false). */
  onEmailDeliveryWaivedChange?: (
    purchaseOrderId: string,
    waived: boolean,
  ) => void | Promise<void>;
};

export function PoEmailDeliveryAlertsStrip({
  items,
  onNavigateToPo,
  onSent,
  onEmailDeliveryWaivedChange,
}: Props) {
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [busyWaiveIds, setBusyWaiveIds] = useState<Set<string>>(new Set());
  const [errByPo, setErrByPo] = useState<Record<string, string>>({});

  if (items.length === 0) return null;

  function addBusy(set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    set((s) => new Set(s).add(id));
  }
  function removeBusy(set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    set((s) => { const next = new Set(s); next.delete(id); return next; });
  }

  async function send(poId: string) {
    setErrByPo((m) => { const next = { ...m }; delete next[poId]; return next; });
    addBusy(setBusyIds, poId);
    try {
      const result = await postSendPurchaseOrderEmail(poId);
      if (!result.ok) {
        setErrByPo((m) => ({ ...m, [poId]: result.error }));
        return;
      }
      onSent?.(poId);
    } catch {
      setErrByPo((m) => ({ ...m, [poId]: 'Network error — could not send email' }));
    } finally {
      removeBusy(setBusyIds, poId);
    }
  }

  async function setWaived(poId: string, waived: boolean) {
    if (!onEmailDeliveryWaivedChange) return;
    addBusy(setBusyWaiveIds, poId);
    try {
      await onEmailDeliveryWaivedChange(poId, waived);
    } finally {
      removeBusy(setBusyWaiveIds, poId);
    }
  }

  return (
    <div className="flex-shrink-0 border-b border-border" role="region">
      <div
        className={cn(
          'px-3 py-2 border-b border-destructive/30',
          'bg-destructive/[0.07]',
        )}
        aria-label="Purchase order email reminders"
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          <AlertTriangle
            className="size-3.5 shrink-0 text-destructive"
            aria-hidden
          />
          <p className="text-[11px] font-semibold text-destructive">
            PO email not recorded ({items.length})
          </p>
        </div>
        <ul className="flex flex-col gap-1.5 max-h-[min(40vh,220px)] overflow-y-auto pr-0.5">
          {items.map((it) => {
            const busy = busyIds.has(it.purchaseOrderId);
            const waiveBusy = busyWaiveIds.has(it.purchaseOrderId);
            const err = errByPo[it.purchaseOrderId];
            return (
              <li key={it.purchaseOrderId}>
                <div
                  className={cn(
                    'flex items-start justify-between gap-2 rounded-md px-2 py-1.5 cursor-pointer',
                    'bg-background/80 border border-destructive/15',
                  )}
                  onClick={() => onNavigateToPo(it)}
                >
                  <div className="min-w-0 flex-1 text-left rounded-sm">
                    <p className="text-[11px] font-medium text-destructive leading-snug break-words">
                      {it.customerLabel}
                      <span className="text-destructive/80 font-normal">
                        {' '}
                        · {it.supplierCompany} · PO #{it.poNumber}
                      </span>
                    </p>
                    <p className="text-[10px] text-destructive/85 mt-0.5 leading-snug">
                      {it.hasEmailContacts
                        ? 'Order channel is email — send the PO to log delivery.'
                        : 'Email channel but no addresses on file — add supplier contacts, then send.'}
                    </p>
                    {err ? (
                      <p className="text-[9px] text-destructive mt-1 leading-snug break-words">
                        {err}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0 items-end">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] rounded-md px-2"
                        disabled={waiveBusy || !onEmailDeliveryWaivedChange}
                        onClick={(e) => {
                          e.stopPropagation();
                          void setWaived(it.purchaseOrderId, true);
                        }}
                      >
                        {waiveBusy ? <Loader2 className="size-3.5 animate-spin" /> : 'Dismiss'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="h-7 shrink-0 text-[10px] rounded-md px-2"
                        disabled={!it.hasEmailContacts || busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void send(it.purchaseOrderId);
                        }}
                      >
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'Send'}
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
