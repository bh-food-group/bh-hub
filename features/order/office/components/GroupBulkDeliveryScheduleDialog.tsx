'use client';

import { useState, useTransition } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  cloneBhSplitTemplateWindows,
  parseSupplierDeliverySchedule,
  supplierDeliveryScheduleFromPartitionWindows,
} from '@/lib/order/supplier-delivery-schedule';
import { useSupplierDeliveryScheduleForm } from '../hooks/use-supplier-delivery-schedule-form';
import { SupplierDeliveryScheduleFields } from './SupplierDeliveryScheduleFields';
import type { SupplierRow } from './SupplierForm';

/** Stable default when internal group has no per-supplier schedule yet (avoids reset loops). */
const INTERNAL_GROUP_DEFAULT_SCHEDULE: unknown =
  supplierDeliveryScheduleFromPartitionWindows(cloneBhSplitTemplateWindows());

export function pickBulkDeliveryScheduleSeed(
  suppliers: SupplierRow[],
  groupId: string,
  groupSlug: string,
): unknown | null {
  const inGroup = suppliers
    .filter((s) => s.groupId === groupId)
    .sort((a, b) => a.company.localeCompare(b.company));
  const withParsed = inGroup.find(
    (s) =>
      s.deliverySchedule != null &&
      parseSupplierDeliverySchedule(s.deliverySchedule),
  );
  if (withParsed?.deliverySchedule != null) {
    return withParsed.deliverySchedule;
  }
  if (groupSlug === 'internal') {
    return INTERNAL_GROUP_DEFAULT_SCHEDULE;
  }
  return null;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: { id: string; name: string; slug: string } | null;
  supplierCount: number;
  seedScheduleRaw: unknown | null;
  onApplied: () => void;
};

export function GroupBulkDeliveryScheduleDialog({
  open,
  onOpenChange,
  group,
  supplierCount,
  seedScheduleRaw,
  onApplied,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const deliveryForm = useSupplierDeliveryScheduleForm(
    open && group ? seedScheduleRaw : null,
  );

  function handleApply() {
    if (!group || supplierCount === 0) return;
    setError(null);
    const vErr = deliveryForm.validateScheduleForSubmit();
    if (vErr) {
      setError(vErr);
      return;
    }
    const schedulePayload = deliveryForm.buildDeliverySchedulePayload();

    startTransition(async () => {
      const res = await fetch(
        `/api/order/supplier-groups/${group.id}/delivery-schedule`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deliverySchedule: schedulePayload }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? `Failed (${res.status})`);
        return;
      }
      onApplied();
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <div className="shrink-0 space-y-1.5 border-b px-6 pt-6 pb-4 pr-14">
          <DialogHeader className="space-y-1.5 text-left">
            <DialogTitle>Bulk delivery schedule</DialogTitle>
            <DialogDescription>
              {group ? (
                <>
                  Update PO default expected delivery for all{' '}
                  <span className="font-medium text-foreground">{supplierCount}</span>{' '}
                  supplier{supplierCount !== 1 ? 's' : ''} in “{group.name}”.
                  Other supplier fields are unchanged.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4 space-y-3">
          {error && (
            <p className="text-[11px] text-destructive rounded bg-destructive/10 px-2 py-1">
              {error}
            </p>
          )}
          <SupplierDeliveryScheduleFields
            form={deliveryForm}
            radioName="bulk-group-delivery-rule"
            intro={
              <p className="text-[10px] text-muted-foreground -mt-0.5">
                The same schedule is written to every supplier in this group.
                Internal groups with no saved schedule open with the BH split
                template as a starting point.
              </p>
            }
          />
        </div>
        <DialogFooter className="shrink-0 border-t px-6 py-4 gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={isPending || !group || supplierCount === 0}
          >
            {isPending ? 'Saving…' : `Apply to ${supplierCount} supplier${supplierCount !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
