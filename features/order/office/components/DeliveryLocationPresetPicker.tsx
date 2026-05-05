'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils/cn';
import type { PoAddress } from '../types/purchase-order';
import { deliveryLocationPresetToPoAddress } from '../utils/delivery-location-preset-to-po-address';

export type DeliveryLocationPresetRow = {
  id: string;
  name: string;
  company: string | null;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  /** `Location`s that reference this preset (many may share one preset). */
  locations: { id: string; code: string; name: string }[];
};

type ApplyPayload = {
  presetId: string;
  poAddress: PoAddress;
  company: string | null;
};

type Props = {
  className?: string;
  /** Current selection id for display; null = none. */
  selectedPresetId?: string | null;
  onApply: (payload: ApplyPayload) => void;
  onClear?: () => void;
  compact?: boolean;
};

const DEBOUNCE_MS = 280;

export function DeliveryLocationPresetPicker({
  className,
  selectedPresetId,
  onApply,
  onClear,
  compact,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<DeliveryLocationPresetRow[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const fetchPresets = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const url =
        q.length > 0
          ? `/api/order/delivery-location-presets?q=${encodeURIComponent(q)}`
          : '/api/order/delivery-location-presets';
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof data?.error === 'string' ? data.error : 'Preset search failed',
        );
        setHits([]);
        return;
      }
      setHits(Array.isArray(data.presets) ? data.presets : []);
    } catch {
      toast.error('Preset search failed');
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void fetchPresets(debounced);
  }, [open, debounced, fetchPresets]);

  const label = useMemo(() => {
    if (!selectedPresetId) return 'Select address';
    const row = hits.find((h) => h.id === selectedPresetId);
    if (row) {
      const loc =
        row.locations.length > 0
          ? row.locations.map((l) => l.code).join(', ')
          : 'No location linked';
      return `${row.name} · ${loc}`;
    }
    return 'Preset applied';
  }, [hits, selectedPresetId]);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
        Delivery location preset
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className={cn(
              'justify-between font-normal text-[11px] rounded-[5px] h-auto min-h-0 py-1 px-1.5',
              compact && 'text-[10px]',
            )}
            aria-expanded={open}
          >
            <span className="flex items-center gap-1 min-w-0 truncate">
              <MapPin className="h-3 w-3 shrink-0 opacity-60" />
              <span className="truncate">{label}</span>
            </span>
            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(100vw-2rem,22rem)] p-2" align="start">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, address, location code…"
            className="h-8 text-xs mb-2"
          />
          <div className="max-h-56 overflow-y-auto border rounded-md divide-y">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : hits.length === 0 ? (
              <p className="text-[11px] text-muted-foreground px-2 py-3 text-center">
                No results · Add presets under Office → Delivery locations
              </p>
            ) : (
              hits.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="w-full text-left px-2 py-1.5 hover:bg-muted/60 flex gap-2 items-start"
                  onClick={() => {
                    onApply({
                      presetId: row.id,
                      poAddress: deliveryLocationPresetToPoAddress(row),
                      company: row.company,
                    });
                    setOpen(false);
                  }}
                >
                  <span className="mt-0.5 shrink-0">
                    {selectedPresetId === row.id ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <span className="inline-block w-3.5" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="text-[11px] font-medium block truncate">
                      {row.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground block truncate">
                      {row.locations.length > 0
                        ? row.locations
                            .map((l) => `${l.code} · ${l.name}`)
                            .join(' · ')
                        : 'No location linked'}
                    </span>
                    <span className="text-[10px] text-muted-foreground block line-clamp-2">
                      {[row.address1, row.city, row.province, row.postalCode]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          {onClear && selectedPresetId ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="w-full mt-2 text-[11px]"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              Clear preset
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
