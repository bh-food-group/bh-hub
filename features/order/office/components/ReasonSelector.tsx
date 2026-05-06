'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export interface ReasonValue {
  category: string;
  subcategory: string;
  notes: string;
}

interface Props {
  value: ReasonValue;
  onChange: (v: ReasonValue) => void;
  disabled?: boolean;
}

const REASON_MAP: Record<string, { label: string; subs: { value: string; label: string }[] }> = {
  supply_shortage: {
    label: 'Supply Shortage',
    subs: [
      { value: 'out_of_stock', label: 'Out of Stock' },
      { value: 'payment_not_cleared', label: 'Payment Not Cleared' },
    ],
  },
  item_damage: {
    label: 'Item Damage',
    subs: [
      { value: 'unknown_damage', label: 'Unknown Damage' },
      { value: 'poor_packaging', label: 'Poor Packaging' },
    ],
  },
  human_error: {
    label: 'Human Error',
    subs: [
      { value: 'office', label: 'Office' },
      { value: 'supply', label: 'Supply' },
      { value: 'delivery', label: 'Delivery' },
    ],
  },
};

export function ReasonSelector({ value, onChange, disabled }: Props) {
  const subcategories = value.category ? (REASON_MAP[value.category]?.subs ?? []) : [];

  function handleCategoryChange(cat: string) {
    onChange({ category: cat, subcategory: '', notes: value.notes });
  }

  function handleSubcategoryChange(sub: string) {
    onChange({ ...value, subcategory: sub });
  }

  return (
    <div className="space-y-3 rounded-md border p-3 bg-muted/30">
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        Reason
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[11px]">Category</Label>
          <Select
            value={value.category}
            onValueChange={handleCategoryChange}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select reason…" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(REASON_MAP).map(([k, v]) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Detail</Label>
          <Select
            value={value.subcategory}
            onValueChange={handleSubcategoryChange}
            disabled={disabled || !value.category}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={value.category ? 'Select detail…' : '—'} />
            </SelectTrigger>
            <SelectContent>
              {subcategories.map((s) => (
                <SelectItem key={s.value} value={s.value} className="text-xs">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px]">Notes (optional)</Label>
        <Textarea
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          disabled={disabled}
          rows={2}
          className="text-xs resize-none"
          placeholder="Additional details…"
        />
      </div>
    </div>
  );
}
