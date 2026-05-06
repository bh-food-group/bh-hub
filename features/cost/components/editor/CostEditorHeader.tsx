'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Copy, Lock, LockOpen, Loader2, Save, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import TagInput from './TagInput';
import RecipePrintButton from '../RecipePrintButton';
import type { CostTag } from '../../types/cost';

interface Props {
  title: string;
  tags: CostTag[];
  locked: boolean;
  isExisting: boolean;
  costId?: string;
  isSaving: boolean;
  isDeleting: boolean;
  isDirty: boolean;
  onTitleChange: (v: string) => void;
  onTagsChange: (tags: CostTag[]) => void;
  onSave: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onLockToggle: () => void;
}

export default function CostEditorHeader({
  title,
  tags,
  locked,
  isExisting,
  costId,
  isSaving,
  isDeleting,
  isDirty,
  onTitleChange,
  onTagsChange,
  onSave,
  onDelete,
  onDuplicate,
  onLockToggle,
}: Props) {
  const t = useTranslations('Cost');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <Input
          className="text-lg font-semibold h-10 flex-1"
          placeholder={t('titlePlaceholder')}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          disabled={locked}
        />

        <div className="flex items-center gap-2 shrink-0">
          {/* Print */}
          {isExisting && costId && (
            <RecipePrintButton costId={costId} />
          )}

          {/* Lock toggle */}
          {isExisting && (
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10"
              onClick={onLockToggle}
              title={locked ? t('unlock') : t('lock')}
            >
              {locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
            </Button>
          )}

          {/* Duplicate */}
          {isExisting && (
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10"
              onClick={onDuplicate}
              title={t('duplicateCost')}
              disabled={locked}
            >
              <Copy className="h-4 w-4" />
            </Button>
          )}

          {/* Delete */}
          {isExisting && (
            <>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 text-destructive hover:bg-destructive/10"
                disabled={isDeleting}
                title={t('deleteCost')}
                onClick={() => setShowDeleteConfirm(true)}
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
              <ConfirmDialog
                open={showDeleteConfirm}
                onOpenChange={setShowDeleteConfirm}
                title={t('deleteCostConfirm')}
                description={t('deleteCostDescription')}
                confirmLabel={t('deleteCost')}
                cancelLabel={t('cancel')}
                variant="destructive"
                onConfirm={onDelete}
                isLoading={isDeleting}
              />
            </>
          )}

          {/* Save */}
          <Button
            className="h-10 gap-2 min-w-[80px]"
            onClick={onSave}
            disabled={isSaving || locked}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isDirty ? t('saveCost') : t('saved')}
          </Button>
        </div>
      </div>

      {/* Tags */}
      <TagInput tags={tags} disabled={locked} onChange={onTagsChange} />
    </div>
  );
}
