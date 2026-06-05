'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils/cn';
import type { ShopifyProductSearchHit } from '@/components/shopify/types';
import { DEFAULT_SHOPIFY_PRODUCT_SEARCH_PATH } from '@/components/shopify/shopify-product-search-constants';

function SearchHitThumb({
  imageUrl,
  label,
  className,
}: {
  imageUrl: string | null | undefined;
  label: string;
  className?: string;
}) {
  const url = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  return (
    <div
      className={cn(
        'h-9 w-9 flex-shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted/30 flex items-center justify-center',
        className,
      )}
      aria-hidden={!url}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote Shopify CDN URLs
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  );
}

function ProductStatusBadge({ status }: { status: ShopifyProductSearchHit['productStatus'] }) {
  const label =
    status === 'ACTIVE' ? 'Active' : status === 'DRAFT' ? 'Draft' : 'Archived';
  const cls =
    status === 'ACTIVE'
      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100'
      : status === 'DRAFT'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100'
        : 'border-border/60 bg-muted/40 text-muted-foreground';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
        cls,
      )}
    >
      {label}
    </span>
  );
}

export type ShopifyProductSearchPanelProps = {
  /** Called when the user picks a catalog variant (single click). */
  onSelect: (hit: ShopifyProductSearchHit) => void;
  /**
   * Path for `GET ?q=` (and optional `includeDraft=1`), returning
   * `{ ok?, hits?, draftProductCount?, error? }` where `hits` match {@link ShopifyProductSearchHit}.
   * @default {@link DEFAULT_SHOPIFY_PRODUCT_SEARCH_PATH}
   */
  searchPath?: string;
  minQueryLength?: number;
  debounceMs?: number;
  /** Placeholder on the search input. */
  searchPlaceholder?: string;
  className?: string;
  /** Max height of the results list. */
  resultsMaxHeightClassName?: string;
  /**
   * Extra query params appended to every search request (e.g. `{ supplierId }`
   * or `{ purchaseOrderId }` to scope results to one supplier's vendors).
   * Entries with empty/undefined values are skipped.
   */
  extraParams?: Record<string, string | null | undefined>;
};

export function ShopifyProductSearchPanel({
  onSelect,
  searchPath = DEFAULT_SHOPIFY_PRODUCT_SEARCH_PATH,
  minQueryLength = 2,
  debounceMs = 280,
  searchPlaceholder = 'Search products…',
  className,
  resultsMaxHeightClassName = 'max-h-56',
  extraParams,
}: ShopifyProductSearchPanelProps) {
  // Stable dependency for the search effect — re-run when scope params change.
  const extraParamsKey = JSON.stringify(extraParams ?? {});
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [hits, setHits] = useState<ShopifyProductSearchHit[]>([]);
  const [draftProductCount, setDraftProductCount] = useState<number | null>(null);
  const [includeShopifyDrafts, setIncludeShopifyDrafts] = useState(false);
  const [loading, setLoading] = useState(false);
  const searchSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), debounceMs);
    return () => clearTimeout(t);
  }, [q, debounceMs]);

  const runSearch = useCallback(async () => {
    const query = debouncedQ.trim();
    if (query.length < minQueryLength) {
      abortRef.current?.abort();
      abortRef.current = null;
      searchSeqRef.current += 1;
      setHits([]);
      setDraftProductCount(null);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const seq = ++searchSeqRef.current;
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set('q', query);
      if (includeShopifyDrafts) sp.set('includeDraft', '1');
      for (const [k, v] of Object.entries(extraParams ?? {})) {
        if (v != null && v !== '') sp.set(k, v);
      }
      const url = `${searchPath}?${sp.toString()}`;
      const res = await fetch(url, { signal: ac.signal });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        hits?: ShopifyProductSearchHit[];
        draftProductCount?: number;
        error?: string;
      };
      if (seq !== searchSeqRef.current) return;
      if (!res.ok) {
        toast.error(
          typeof data?.error === 'string' ? data.error : 'Product search failed',
        );
        setHits([]);
        setDraftProductCount(null);
        return;
      }
      setHits(Array.isArray(data.hits) ? data.hits : []);
      const dc = data.draftProductCount;
      setDraftProductCount(typeof dc === 'number' && Number.isFinite(dc) ? dc : null);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (seq !== searchSeqRef.current) return;
      toast.error('Product search failed');
      setHits([]);
      setDraftProductCount(null);
    } finally {
      if (seq === searchSeqRef.current) {
        setLoading(false);
      }
    }
    // extraParamsKey is the stable serialization of extraParams (object identity changes each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, minQueryLength, searchPath, includeShopifyDrafts, extraParamsKey]);

  useEffect(() => {
    void runSearch();
    return () => {
      abortRef.current?.abort();
    };
  }, [runSearch]);

  const manualSearch = useCallback(() => {
    void runSearch();
  }, [runSearch]);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex gap-2">
        <Input
          placeholder={searchPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') manualSearch();
          }}
        />
        <Button type="button" size="sm" variant="secondary" onClick={manualSearch}>
          {loading ? '…' : 'Search'}
        </Button>
      </div>
      {debouncedQ.trim().length >= minQueryLength ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/15 px-2 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <Switch
              id="shopify-product-search-include-drafts"
              size="sm"
              checked={includeShopifyDrafts}
              onCheckedChange={(v) => setIncludeShopifyDrafts(Boolean(v))}
            />
            <Label
              htmlFor="shopify-product-search-include-drafts"
              className="text-[11px] font-normal leading-snug cursor-pointer"
            >
              Show draft products
            </Label>
          </div>
          <div className="text-[10px] text-muted-foreground whitespace-nowrap">
            {draftProductCount === null
              ? '…'
              : `${draftProductCount} draft product${draftProductCount === 1 ? '' : 's'} match`}
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          'overflow-y-auto divide-y rounded-md border',
          resultsMaxHeightClassName,
        )}
      >
        {hits.length === 0 ? (
          <div className="p-3 text-[12px] text-muted-foreground">
            {debouncedQ.length < minQueryLength
              ? `Enter at least ${minQueryLength} characters.`
              : loading
                ? 'Searching…'
                : 'No results'}
          </div>
        ) : (
          hits.map((h) => (
            <button
              key={h.variantId}
              type="button"
              className="flex w-full items-start gap-2 px-3 py-2 text-left text-[12px] hover:bg-muted/50"
              onClick={() => onSelect(h)}
            >
              <SearchHitThumb imageUrl={h.imageUrl} label={h.productTitle} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-1.5 min-w-0">
                  <div className="font-medium min-w-0 flex-1 leading-snug">{h.productTitle}</div>
                  <ProductStatusBadge status={h.productStatus ?? 'ACTIVE'} />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {(h.variantTitle ?? 'Default') +
                    (h.sku ? ` · ${h.sku}` : '') +
                    (h.price ? ` · $${h.price}` : '')}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
