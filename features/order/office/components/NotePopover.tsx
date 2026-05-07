'use client';

import { Popover } from 'radix-ui';
import { StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  note: string;
  label?: string;
  stopRowClick?: boolean;
};

export function NotePopover({ note, label = 'Note', stopRowClick }: Props) {
  if (!note) return null;
  return (
    <Popover.Root modal>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 w-7 shrink-0 p-0 text-amber-700 hover:bg-amber-100 hover:text-amber-900',
            'dark:text-amber-500 dark:hover:bg-amber-950/50 dark:hover:text-amber-300',
          )}
          aria-label={`View ${label.toLowerCase()}`}
          onClick={(e) => {
            if (stopRowClick) e.stopPropagation();
          }}
        >
          <StickyNote className="size-3.5" aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            'z-[100] max-h-[min(16rem,70vh)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-md border bg-popover p-3 text-popover-foreground shadow-md',
            'outline-none',
          )}
          onPointerDownOutside={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm leading-snug">
            {note}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
