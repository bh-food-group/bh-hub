'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Trash2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { UNIT_PRICE_KEY } from '../../utils/calculations';
import type { PriceEditorItem } from '../../types/cost';

/** Formats a number for an input field, trimming float noise and trailing zeros. */
function formatNum(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

interface Props {
  prices: PriceEditorItem[];
  pricePerProduct: number;
  disabled?: boolean;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<PriceEditorItem>) => void;
  onRemove: (id: string) => void;
}

export default function PriceSection({
  prices,
  pricePerProduct,
  disabled,
  onAdd,
  onUpdate,
  onRemove,
}: Props) {
  const t = useTranslations('Cost');

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
          {t('prices')}
        </h4>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={onAdd}
          disabled={disabled}
        >
          <Plus className="h-3 w-3" />
          {t('addPrice')}
        </Button>
      </div>

      {/* Unit price baseline */}
      <div className="flex items-center justify-between text-sm py-1 border-b">
        <span className="text-muted-foreground">{t('unitPrice')}</span>
        <span className="tabular-nums font-medium">${pricePerProduct.toFixed(4)}</span>
      </div>

      {prices.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">{t('noPrices')}</p>
      ) : (
        <div className="space-y-3">
          {prices.map((price) => (
            <PriceRow
              key={price.id}
              price={price}
              prices={prices}
              pricePerProduct={pricePerProduct}
              disabled={disabled}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PriceRow({
  price,
  prices,
  pricePerProduct,
  disabled,
  onUpdate,
  onRemove,
}: {
  price: PriceEditorItem;
  prices: PriceEditorItem[];
  pricePerProduct: number;
  disabled?: boolean;
  onUpdate: (id: string, patch: Partial<PriceEditorItem>) => void;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations('Cost');

  // Local text state lets the user type freely (e.g. trailing "."), while still
  // resyncing whenever the underlying value changes from the other input or cost edits.
  const [marginText, setMarginText] = useState(() => formatNum(price.margin));
  const [priceText, setPriceText] = useState(() => formatNum(price.price));

  useEffect(() => {
    if (Math.abs(parseFloat(marginText) - price.margin) > 1e-6) {
      setMarginText(formatNum(price.margin));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [price.margin]);

  useEffect(() => {
    if (Math.abs(parseFloat(priceText) - price.price) > 1e-6) {
      setPriceText(formatNum(price.price));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [price.price]);

  const baseOptions = [
    { value: UNIT_PRICE_KEY, label: t('unitPrice') },
    ...prices
      .filter((p) => p.id !== price.id)
      .map((p) => ({ value: p.id, label: p.title || t('unnamedPrice') })),
  ];

  return (
    <div className="rounded border p-3 space-y-2 bg-muted/30">
      <div className="flex items-center gap-2">
        <Input
          className="h-7 text-sm flex-1"
          placeholder={t('priceName')}
          value={price.title}
          onChange={(e) => onUpdate(price.id, { title: e.target.value })}
          disabled={disabled}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(price.id)}
          disabled={disabled}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        {/* Base */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('priceBase')}</Label>
          <Select
            value={price.base ?? UNIT_PRICE_KEY}
            onValueChange={(v) => onUpdate(price.id, { base: v })}
            disabled={disabled}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {baseOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Margin */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('margin')} (%)</Label>
          <Input
            type="number"
            step="0.1"
            className="h-7 text-sm"
            value={marginText}
            onChange={(e) => {
              setMarginText(e.target.value);
              onUpdate(price.id, { margin: parseFloat(e.target.value) || 0 });
            }}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Calculated price + isFinalPrice */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <Switch
            id={`final-${price.id}`}
            checked={price.isFinalPrice}
            onCheckedChange={(v) => onUpdate(price.id, { isFinalPrice: v })}
            disabled={disabled}
            className="scale-75"
          />
          <Label htmlFor={`final-${price.id}`} className="text-xs text-muted-foreground cursor-pointer">
            {t('isFinalPrice')}
          </Label>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold">$</span>
          <Input
            type="number"
            step="0.01"
            className="h-7 w-24 text-sm text-right tabular-nums font-semibold"
            value={priceText}
            onChange={(e) => {
              setPriceText(e.target.value);
              onUpdate(price.id, { price: parseFloat(e.target.value) || 0 });
            }}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
