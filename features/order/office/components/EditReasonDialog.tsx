'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ReasonSelector, DEFAULT_REASON_OPTIONS, type ReasonValue, type ReasonCategory } from './ReasonSelector';
import { ReasonOptionsManager } from './ReasonOptionsManager';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordId: string;
  initialReason: ReasonValue;
  onSaved: (record: { reasonCategory: string; reasonSubcategory: string; reasonNotes: string | null }) => void;
  onOptionsSaved?: (options: ReasonCategory[]) => void;
};

export function EditReasonDialog({ open, onOpenChange, recordId, initialReason, onSaved, onOptionsSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState<ReasonValue>(initialReason);
  const [reasonOptions, setReasonOptions] = useState<ReasonCategory[]>(DEFAULT_REASON_OPTIONS);
  const [showManager, setShowManager] = useState(false);

  useEffect(() => {
    if (!open) { setShowManager(false); return; }
    setReason(initialReason);
    fetch('/api/order/reason-options')
      .then((r) => r.json())
      .then((data: { options?: ReasonCategory[] }) => {
        if (Array.isArray(data.options) && data.options.length > 0) {
          setReasonOptions(data.options);
        }
      })
      .catch(() => {/* keep default */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSave() {
    if (!reason.category) return;
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
          <div className="flex items-center justify-between">
            <DialogTitle>{showManager ? 'Manage Reason Options' : 'Edit Reason'}</DialogTitle>
            {!showManager && (
              <Button
                variant="ghost"
                size="xs"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => setShowManager(true)}
                title="Manage reason options"
              >
                <Settings className="size-3.5" />
              </Button>
            )}
          </div>
        </DialogHeader>

        {showManager ? (
          <ReasonOptionsManager
            initialOptions={reasonOptions}
            onSaved={(newOptions) => {
              setReasonOptions(newOptions);
              onOptionsSaved?.(newOptions);
              const catStillExists = newOptions.some((c) => c.value === reason.category);
              if (!catStillExists) setReason({ category: '', subcategory: '', notes: reason.notes });
              setShowManager(false);
            }}
            onCancel={() => setShowManager(false)}
          />
        ) : (
          <div className="space-y-4 pt-1">
            <ReasonSelector value={reason} onChange={setReason} disabled={saving} options={reasonOptions} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !reason.category}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
