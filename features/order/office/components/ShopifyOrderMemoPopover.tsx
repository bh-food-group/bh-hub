'use client';

import { NotePopover } from './NotePopover';

type Props = {
  memo: string;
  stopRowClick?: boolean;
};

export function ShopifyOrderMemoPopover({ memo, stopRowClick }: Props) {
  return <NotePopover note={memo} label="Order note" stopRowClick={stopRowClick} />;
}
