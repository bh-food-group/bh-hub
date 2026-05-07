'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';

type Props = {
  value: number;
  onChange: (val: number) => void;
  /** Original PO qty — used as max and shown as hint when value differs. Omit for free-form entry. */
  originalQty?: number;
  className?: string;
};

export function QtyField({ value, onChange, originalQty, className }: Props) {
  return (
    <div className="flex flex-col gap-0.5">
      <Input
        type="number"
        min={1}
        max={originalQty}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(Math.max(1, n));
        }}
        className={cn('h-7 text-[11px] tabular-nums', className)}
      />
      {originalQty !== undefined && value !== originalQty && (
        <span className="text-[9px] text-muted-foreground tabular-nums">
          / {originalQty}
        </span>
      )}
    </div>
  );
}
