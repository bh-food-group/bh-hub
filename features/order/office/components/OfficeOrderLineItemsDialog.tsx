'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { ShopifyLineProductCell } from './ShopifyLineProductCell';
import type {
  OfficePoTableLineItem,
  OfficeShopifyTableLineItem,
} from '../types/office-table-view';
import { mergeProductAndVariantTitle } from '../types/purchase-order';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  shopifyAdminStoreHandle?: string | null;
} & (
  | {
      variant: 'shopify';
      title: string;
      subtitle: string;
      currency: string;
      lines: OfficeShopifyTableLineItem[];
    }
  | {
      variant: 'po';
      title: string;
      subtitle: string;
      currency: string;
      lines: OfficePoTableLineItem[];
    }
);

function shopifyLineLabel(l: OfficeShopifyTableLineItem): string {
  const t = (l.title ?? '').trim() || '—';
  return mergeProductAndVariantTitle(t, l.variantTitle);
}

function poLineLabel(l: OfficePoTableLineItem): string {
  const t = (l.productTitle ?? '').trim() || '—';
  return mergeProductAndVariantTitle(t, l.variantTitle);
}

function formatUnitPrice(amount: string | null, currency: string): string {
  if (amount == null || amount === '') return '—';
  const c = currency?.trim() || 'USD';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: c,
      maximumFractionDigits: 2,
    }).format(parseFloat(amount));
  } catch {
    return `${amount} ${c}`;
  }
}

export function OfficeOrderLineItemsDialog(props: Props) {
  const { open, onOpenChange, loading, error, shopifyAdminStoreHandle } = props;
  const title = props.variant === 'shopify' || props.variant === 'po' ? props.title : '';
  const subtitle =
    props.variant === 'shopify' || props.variant === 'po' ? props.subtitle : '';
  const currency =
    props.variant === 'shopify' || props.variant === 'po' ? props.currency : 'USD';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-4 py-3 pr-12 text-left">
          <DialogTitle className="text-sm font-semibold leading-tight">{title}</DialogTitle>
          {subtitle ? (
            <p className="mt-1 text-xs text-muted-foreground leading-snug">{subtitle}</p>
          ) : null}
        </DialogHeader>

        <div className="max-h-[min(28rem,70vh)] overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner className="size-7 text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive py-4">{error}</p>
          ) : props.variant === 'shopify' ? (
            props.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No line items.</p>
            ) : (
              <ul className="space-y-3">
                {props.lines.map((l, i) => (
                  <li
                    key={`${l.sku ?? ''}-${i}`}
                    className="flex gap-2.5 border-b border-border/60 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1 text-[12px] leading-snug">
                      <ShopifyLineProductCell
                        shopifyAdminStoreHandle={shopifyAdminStoreHandle}
                        shopifyProductGid={l.shopifyProductGid}
                        shopifyVariantGid={l.shopifyVariantGid}
                        imageUrl={l.imageUrl}
                        label={shopifyLineLabel(l)}
                        sku={l.sku}
                        className="items-start"
                      />
                      <div className="mt-0.5 text-[11px] text-muted-foreground font-mono">
                        {l.sku?.trim() || '—'} · Qty {l.quantity}
                        {l.price != null && l.price !== ''
                          ? ` · ${formatUnitPrice(l.price, currency)}`
                          : ''}
                      </div>
                      {(l.shopifyVendor || l.supplierCompany) && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {l.shopifyVendor ? (
                            <span>
                              Vendor: <span className="text-foreground/90">{l.shopifyVendor}</span>
                            </span>
                          ) : null}
                          {l.shopifyVendor && l.supplierCompany ? ' · ' : null}
                          {l.supplierCompany ? (
                            <span>
                              Supplier:{' '}
                              <span className="text-foreground/90">{l.supplierCompany}</span>
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : props.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No line items.</p>
          ) : (
            <ul className="space-y-3">
              {props.lines.map((l) => (
                <li
                  key={l.sequence}
                  className="flex gap-2.5 border-b border-border/60 pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1 text-[12px] leading-snug">
                    <ShopifyLineProductCell
                      shopifyAdminStoreHandle={shopifyAdminStoreHandle}
                      shopifyProductGid={l.shopifyProductGid}
                      shopifyVariantGid={l.shopifyVariantGid}
                      imageUrl={l.imageUrl}
                      label={poLineLabel(l)}
                      sku={l.sku}
                      className="items-start"
                    />
                    <div className="mt-0.5 text-[11px] text-muted-foreground font-mono">
                      {l.sku?.trim() || '—'} · Qty {l.quantity}
                      {l.supplierRef?.trim() ? ` · Ref ${l.supplierRef.trim()}` : ''}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                      {formatUnitPrice(l.itemPrice, currency)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
