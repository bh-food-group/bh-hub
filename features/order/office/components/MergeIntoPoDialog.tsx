'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@/components/ui/table';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/cn';
import { formatOfficeDateChip } from '../utils/format-date-label';
import type { OfficePurchaseOrderBlock } from '../types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filtered to open POs (not archived / fulfilled / completed) for the active supplier. */
  purchaseOrders: OfficePurchaseOrderBlock[];
  /** Number of inbox lines currently checked for the merge. */
  includedLineCount: number;
  onConfirm: (poId: string) => void | Promise<void>;
  submitting?: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  unfulfilled: 'Unfulfilled',
  partially_fulfilled: 'Partially fulfilled',
};

function formatExpected(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  try {
    return formatOfficeDateChip(ymd);
  } catch {
    return ymd;
  }
}

function poLineCount(po: OfficePurchaseOrderBlock): number {
  if (po.lineItems.length > 0) return po.lineItems.length;
  return po.panelMeta?.fulfillTotalCount ?? 0;
}

export function MergeIntoPoDialog({
  open,
  onOpenChange,
  purchaseOrders,
  includedLineCount,
  onConfirm,
  submitting = false,
}: Props) {
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const prevOpenRef = useRef(false);

  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (!justOpened) return;
    // Fresh selection each time the dialog opens; preselect when there's a single candidate.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- snapshot on open transition
    setSelectedPoId(purchaseOrders.length === 1 ? purchaseOrders[0].id : null);
  }, [open, purchaseOrders]);

  const hasCandidates = purchaseOrders.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge into existing PO</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          {includedLineCount > 0
            ? `${includedLineCount} selected item${includedLineCount === 1 ? '' : 's'} will be added to the chosen PO.`
            : 'Select items in the inbox first, then choose a PO to merge into.'}
        </p>

        {hasCandidates ? (
          <div className="max-h-[320px] overflow-y-auto rounded-md border">
            <Table>
              <TableBody>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-8" />
                  <TableHead>PO #</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
                {purchaseOrders.map((po) => {
                  const selected = po.id === selectedPoId;
                  return (
                    <TableRow
                      key={po.id}
                      className={cn(
                        'cursor-pointer',
                        selected && 'bg-accent/60 hover:bg-accent/60',
                      )}
                      onClick={() => setSelectedPoId(po.id)}
                    >
                      <TableCell className="align-middle">
                        <input
                          type="radio"
                          name="merge-target-po"
                          checked={selected}
                          onChange={() => setSelectedPoId(po.id)}
                          className="h-3.5 w-3.5"
                        />
                      </TableCell>
                      <TableCell className="font-medium">#{po.poNumber}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatExpected(po.panelMeta?.expectedDate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {poLineCount(po)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="gray" className="rounded px-1.5 text-[10px]">
                          {STATUS_LABEL[po.status] ?? po.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="rounded-md border border-dashed py-8 text-center text-xs text-muted-foreground">
            No open POs for this supplier.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!selectedPoId || includedLineCount === 0 || submitting}
            onClick={() => {
              if (selectedPoId) void onConfirm(selectedPoId);
            }}
          >
            {submitting ? <Spinner className="mr-1 h-4 w-4 text-white" /> : null}
            Merge
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
