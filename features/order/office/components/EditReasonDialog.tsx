'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ReasonSelector, type ReasonValue } from './ReasonSelector';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordId: string;
  initialReason: ReasonValue;
  onSaved: (record: { reasonCategory: string; reasonSubcategory: string; reasonNotes: string | null }) => void;
};

export function EditReasonDialog({ open, onOpenChange, recordId, initialReason, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState<ReasonValue>(initialReason);

  useEffect(() => {
    if (open) setReason(initialReason);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSave() {
    if (!reason.category || !reason.subcategory) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/order/refund-replacements/${recordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reasonCategory: reason.category,
          reasonSubcategory: reason.subcategory,
          reasonNotes: reason.notes || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Failed to update reason');
      }
      onSaved({ reasonCategory: reason.category, reasonSubcategory: reason.subcategory, reasonNotes: reason.notes || null });
      toast.success('Reason updated');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error updating reason');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Reason</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <ReasonSelector value={reason} onChange={setReason} disabled={saving} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !reason.category || !reason.subcategory}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
