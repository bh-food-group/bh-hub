'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  OfficeCatalogProductStatus,
  OfficeCatalogVariantRow,
} from '@/lib/shopify/listProductsCatalog';
import { cn } from '@/lib/utils/cn';
import { LineItemThumb } from './LineItemThumb';
import { Spinner } from '@/components/ui/spinner';
import { RefreshCwIcon } from 'lucide-react';

type Props = {
  vendors: string[];
  shopifyConfigured: boolean;
};

type CatalogResponse = {
  ok?: boolean;
  rows?: OfficeCatalogVariantRow[];
  endCursor?: string | null;
  hasNextPage?: boolean;
  draftProductCount?: number;
  error?: string;
};

function CatalogProductStatusBadge({ status }: { status: OfficeCatalogProductStatus }) {
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
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
        cls,
      )}
    >
      {label}
    </span>
  );
}

type NotesResponse = {
  ok?: boolean;
  notes?: { shopifyVariantGid: string; note: string }[];
  error?: string;
};

export function ItemSettingsClient({ vendors, shopifyConfigured }: Props) {
  const sortedVendors = useMemo(
    () =>
      [...vendors].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }),
      ),
    [vendors],
  );

  const [vendor, setVendor] = useState('');
  /** Applied title filter (sent to Shopify `products(query)`). */
  const [titleQuery, setTitleQuery] = useState('');
  const [titleApplied, setTitleApplied] = useState('');
  const [rows, setRows] = useState<OfficeCatalogVariantRow[]>([]);
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [includeShopifyDrafts, setIncludeShopifyDrafts] = useState(false);
  const [draftProductCount, setDraftProductCount] = useState<number | null>(null);

  const [notesByVariant, setNotesByVariant] = useState<Record<string, string>>(
    {},
  );
  const notesRef = useRef<Record<string, string>>({});
  useEffect(() => {
    notesRef.current = notesByVariant;
  }, [notesByVariant]);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  /** Variant GIDs currently showing the note textarea (edit mode). */
  const [editingByVariant, setEditingByVariant] = useState<
    Record<string, boolean>
  >({});

  const loadNotes = useCallback(async () => {
    try {
      const res = await fetch('/api/shopify/variant-notes');
      const data = (await res.json().catch(() => ({}))) as NotesResponse;
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to load saved notes');
        return;
      }
      const next: Record<string, string> = {};
      for (const n of data.notes ?? []) {
        next[n.shopifyVariantGid] = n.note;
      }
      setNotesByVariant(next);
      notesRef.current = next;
    } catch {
      toast.error('Failed to load saved notes');
    }
  }, []);

  const fetchPage = useCallback(
    async (cursor: string | null, append: boolean) => {
      const qs = new URLSearchParams();
      qs.set('first', '25');
      if (cursor) qs.set('after', cursor);
      if (vendor.trim()) qs.set('vendor', vendor.trim());
      if (titleApplied.trim()) qs.set('title', titleApplied.trim());
      if (includeShopifyDrafts) qs.set('includeDraft', '1');
      const res = await fetch(
        `/api/shopify/products/catalog?${qs.toString()}`,
      );
      const data = (await res.json().catch(() => ({}))) as CatalogResponse;
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const nextRows = data.rows ?? [];
      setEndCursor(data.endCursor ?? null);
      setHasNext(Boolean(data.hasNextPage));
      setRows((prev) => (append ? [...prev, ...nextRows] : nextRows));
      const dc = data.draftProductCount;
      setDraftProductCount(
        typeof dc === 'number' && Number.isFinite(dc) ? dc : null,
      );

      const notes = notesRef.current;
      setDrafts((prev) => {
        if (!append) {
          const out: Record<string, string> = {};
          for (const r of nextRows) {
            out[r.variantId] = notes[r.variantId] ?? '';
          }
          return out;
        }
        const out = { ...prev };
        for (const r of nextRows) {
          if (out[r.variantId] === undefined) {
            out[r.variantId] = notes[r.variantId] ?? '';
          }
        }
        return out;
      });
    },
    [vendor, titleApplied, includeShopifyDrafts],
  );

  const reloadCatalog = useCallback(async () => {
    if (!shopifyConfigured) return;
    setLoading(true);
    try {
      await loadNotes();
      await fetchPage(null, false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load catalog');
      setRows([]);
      setHasNext(false);
      setEndCursor(null);
      setDraftProductCount(null);
    } finally {
      setLoading(false);
    }
  }, [fetchPage, loadNotes, shopifyConfigured]);

  useEffect(() => {
    if (!shopifyConfigured) return;
    void reloadCatalog();
  }, [shopifyConfigured, vendor, titleApplied, reloadCatalog]);

  const applyTitleSearch = useCallback(() => {
    setTitleApplied(titleQuery.trim());
  }, [titleQuery]);

  const loadMore = useCallback(async () => {
    if (!endCursor || loadingMore || !hasNext) return;
    setLoadingMore(true);
    try {
      await fetchPage(endCursor, true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }, [endCursor, fetchPage, hasNext, loadingMore]);

  const saveNote = useCallback(
    async (variantId: string) => {
      const raw = drafts[variantId] ?? '';
      setSavingId(variantId);
      try {
        const res = await fetch('/api/shopify/variant-notes', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopifyVariantGid: variantId,
            note: raw.trim() ? raw : null,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          toast.error(data.error ?? 'Save failed');
          return;
        }
        setNotesByVariant((prev) => {
          const next = { ...prev };
          if (raw.trim()) next[variantId] = raw.trim();
          else delete next[variantId];
          notesRef.current = next;
          return next;
        });
        setDrafts((prev) => ({
          ...prev,
          [variantId]: raw.trim() ? raw.trim() : '',
        }));
        setEditingByVariant((prev) => {
          const next = { ...prev };
          delete next[variantId];
          return next;
        });
        toast.success('Saved');
      } catch {
        toast.error('Network error');
      } finally {
        setSavingId(null);
      }
    },
    [drafts],
  );

  if (!shopifyConfigured) {
    return (
      <p className="text-sm text-muted-foreground">
        Shopify Admin API is not configured. Set server env so catalog and notes
        can load.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="w-full rounded-md border border-border/60 bg-muted/15 px-2 py-2 sm:px-2.5 sm:py-2">
        <div className="grid grid-cols-1 gap-y-1.5 sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:gap-x-3 sm:gap-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Shopify vendor
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Search by item title
          </div>

          <select
            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[11px] shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
          >
            <option value="">All vendors</option>
            {sortedVendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>

          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Input
              className="h-8 min-w-0 flex-1 text-[11px] sm:min-w-[7rem]"
              value={titleQuery}
              onChange={(e) => setTitleQuery(e.target.value)}
              placeholder="e.g. olive oil"
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyTitleSearch();
              }}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 px-2.5 text-[11px]"
              disabled={loading}
              onClick={() => applyTitleSearch()}
            >
              Search
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              title="Reload catalog"
              aria-label="Reload catalog"
              disabled={loading}
              onClick={() => void reloadCatalog()}
            >
              {loading ? (
                <Spinner className="size-3.5" />
              ) : (
                <RefreshCwIcon className="size-3.5" />
              )}
            </Button>
          </div>

          {titleApplied.trim() ? (
            <div className="sm:col-span-1">
              <button
                type="button"
                className="text-left text-[10px] text-muted-foreground underline decoration-muted-foreground/60 underline-offset-2 hover:text-foreground hover:decoration-foreground"
                onClick={() => {
                  setTitleQuery('');
                  setTitleApplied('');
                }}
              >
                Clear title filter
              </button>
            </div>
          ) : null}

          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-background/80 px-2 py-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <Switch
                id="office-catalog-include-shopify-drafts"
                size="sm"
                checked={includeShopifyDrafts}
                onCheckedChange={(v) => setIncludeShopifyDrafts(Boolean(v))}
              />
              <Label
                htmlFor="office-catalog-include-shopify-drafts"
                className="text-[11px] font-normal leading-snug cursor-pointer"
              >
                Show draft products in results
              </Label>
            </div>
            <div className="text-[10px] text-muted-foreground whitespace-nowrap">
              {draftProductCount === null
                ? '…'
                : `${draftProductCount} draft product${draftProductCount === 1 ? '' : 's'} match filters`}
            </div>
          </div>
        </div>
      </div>

      <div className="border rounded-[10px] overflow-hidden bg-background">
        <Table className="text-[11px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[32%] text-[10px] uppercase text-muted-foreground">
                Product
              </TableHead>
              <TableHead className="w-[8%] text-[10px] uppercase text-muted-foreground">
                Status
              </TableHead>
              <TableHead className="w-[12%] text-[10px] uppercase text-muted-foreground">
                Vendor
              </TableHead>
              <TableHead className="w-[36%] text-[10px] uppercase text-muted-foreground">
                Default note (PO / PDF)
              </TableHead>
              <TableHead className="w-[12%] text-right text-[10px] uppercase text-muted-foreground">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-muted-foreground py-8 text-center"
                >
                  Loading catalog…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-muted-foreground py-8 text-center"
                >
                  No variants in this page. Try another vendor or use Reload.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const label = `${r.productTitle}${r.variantTitle ? ` — ${r.variantTitle}` : ''}`;
                const draft = drafts[r.variantId] ?? '';
                const isEditing = Boolean(editingByVariant[r.variantId]);
                const saved = notesByVariant[r.variantId] ?? '';
                const viewerText = saved.trim();

                return (
                  <TableRow key={r.variantId}>
                    <TableCell className="align-top py-2">
                      <div className="flex gap-2 min-w-0">
                        <LineItemThumb imageUrl={r.imageUrl} label={label} />
                        <div className="min-w-0">
                          <div className="font-medium leading-tight">
                            {r.productTitle}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {(r.variantTitle ?? 'Default') +
                              (r.sku ? ` · ${r.sku}` : '')}
                          </div>
                          <div className="text-[9px] font-mono text-muted-foreground truncate mt-0.5">
                            {r.variantId}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top py-2">
                      <CatalogProductStatusBadge status={r.productStatus} />
                    </TableCell>
                    <TableCell className="align-top py-2 text-[11px] text-muted-foreground">
                      {r.vendor?.trim() || '—'}
                    </TableCell>
                    <TableCell className="align-top py-2">
                      {isEditing ? (
                        <Textarea
                          className="min-h-[5.5rem] max-h-48 resize-y text-[11px] leading-snug py-1.5 md:text-[11px]"
                          value={draft}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [r.variantId]: e.target.value,
                            }))
                          }
                          maxLength={8000}
                          rows={4}
                          placeholder="Product default note for new PO lines / PDF. Enter for new lines."
                          autoFocus
                        />
                      ) : (
                        <div
                          className="min-h-[5.5rem] max-h-48 overflow-y-auto rounded-md border border-transparent bg-muted/20 px-2 py-1.5 text-[11px] leading-snug text-foreground whitespace-pre-wrap"
                          role="region"
                          aria-label="Default note (read-only)"
                        >
                          {viewerText ? (
                            viewerText
                          ) : (
                            <span className="text-muted-foreground">
                              No default note. Use Edit to add one.
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top py-2 text-right">
                      {isEditing ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8 text-[11px]"
                            disabled={savingId === r.variantId}
                            onClick={() => void saveNote(r.variantId)}
                          >
                            {savingId === r.variantId ? '…' : 'Save'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[10px] text-muted-foreground"
                            disabled={savingId === r.variantId}
                            onClick={() => {
                              setDrafts((prev) => ({
                                ...prev,
                                [r.variantId]: saved,
                              }));
                              setEditingByVariant((prev) => {
                                const next = { ...prev };
                                delete next[r.variantId];
                                return next;
                              });
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-[11px]"
                          onClick={() => {
                            setDrafts((prev) => ({
                              ...prev,
                              [r.variantId]: saved,
                            }));
                            setEditingByVariant((prev) => ({
                              ...prev,
                              [r.variantId]: true,
                            }));
                          }}
                        >
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {hasNext && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore || !endCursor}
            onClick={() => void loadMore()}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
