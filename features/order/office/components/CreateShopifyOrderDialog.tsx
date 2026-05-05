'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  ShopifyProductSearchDialog,
  type ShopifyProductSearchHit,
} from '@/components/shopify';
import { toIso3166Alpha2CountryCode } from '@/lib/shopify/shopify-country';
import type { ShopifyAdminCustomerNode } from '@/lib/shopify/fetchCustomers';
import type { ShopifyMailingAddress } from '@/types/shopify';
import type { ShopifyOrderCreateBody } from '@/lib/api/schemas';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DeliveryLocationPresetPicker } from './DeliveryLocationPresetPicker';

type LineRow = {
  key: string;
  kind: 'variant';
  variantGid: string;
  label: string;
  sku: string | null;
  quantity: number;
};

function newKey(): string {
  return `r_${Math.random().toString(36).slice(2, 11)}`;
}

function splitName(name: string | null | undefined): {
  firstName?: string;
  lastName?: string;
} {
  const t = (name ?? '').trim();
  if (!t) return {};
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function hasStreetLine(
  addr: ShopifyMailingAddress | null | undefined,
): boolean {
  return Boolean(
    (addr?.address1 ?? '').trim() || (addr?.address2 ?? '').trim(),
  );
}

function pickCustomerAddress(
  node: ShopifyAdminCustomerNode,
): ShopifyMailingAddress | null {
  if (hasStreetLine(node.defaultAddress)) return node.defaultAddress;
  const first = node.addressesV2?.edges?.[0]?.node;
  if (hasStreetLine(first)) return first ?? null;
  return null;
}

function provinceCodeFromAddr(addr: ShopifyMailingAddress): string {
  const code = addr.provinceCode?.trim();
  if (code) return code;
  const p = (addr.province ?? '').trim();
  if (p.length >= 2 && p.length <= 4 && /^[A-Za-z]+$/.test(p))
    return p.toUpperCase();
  return '';
}

/** Single-line summary for compact address display (name · company · street · city, ST zip · CC · phone). */
function formatAddressSummaryLine(p: {
  firstName: string;
  lastName: string;
  company: string;
  addr1: string;
  addr2: string;
  city: string;
  provinceCode: string;
  zip: string;
  countryCode: string;
  phone: string;
}): string | null {
  const segs: string[] = [];
  const name = [p.firstName.trim(), p.lastName.trim()]
    .filter(Boolean)
    .join(' ');
  if (name) segs.push(name);
  if (p.company.trim()) segs.push(p.company.trim());
  const street = [p.addr1.trim(), p.addr2.trim()].filter(Boolean).join(', ');
  if (street) segs.push(street);
  const provZip = [p.provinceCode.trim(), p.zip.trim()]
    .filter(Boolean)
    .join(' ');
  const cityPart = [p.city.trim(), provZip].filter(Boolean).join(', ');
  if (cityPart) segs.push(cityPart);
  const cc = p.countryCode.trim().toUpperCase();
  if (cc) segs.push(cc);
  if (p.phone.trim()) segs.push(p.phone.trim());
  return segs.length ? segs.join(' · ') : null;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
};

const CUSTOMER_SEARCH_DEBOUNCE_MS = 320;

export function CreateShopifyOrderDialog({
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerHits, setCustomerHits] = useState<ShopifyAdminCustomerNode[]>(
    [],
  );
  /** Trimmed query that `customerHits` belong to; only set after a successful Search. */
  const [lastCustomerSearchQuery, setLastCustomerSearchQuery] = useState<
    string | null
  >(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [debouncedCustomerQuery, setDebouncedCustomerQuery] = useState('');
  const customerSearchSeqRef = useRef(0);
  const [selectedCustomer, setSelectedCustomer] =
    useState<ShopifyAdminCustomerNode | null>(null);

  const [addr1, setAddr1] = useState('');
  const [addr2, setAddr2] = useState('');
  const [city, setCity] = useState('');
  const [provinceCode, setProvinceCode] = useState('');
  const [zip, setZip] = useState('');
  const [countryCode, setCountryCode] = useState('CA');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const [billingSameAsShipping, setBillingSameAsShipping] = useState(true);
  const [billAddr1, setBillAddr1] = useState('');
  const [billAddr2, setBillAddr2] = useState('');
  const [billCity, setBillCity] = useState('');
  const [billProvinceCode, setBillProvinceCode] = useState('');
  const [billZip, setBillZip] = useState('');
  const [billCountryCode, setBillCountryCode] = useState('CA');

  const [lines, setLines] = useState<LineRow[]>([]);
  const [productPickOpen, setProductPickOpen] = useState(false);
  const [financialStatus, setFinancialStatus] =
    useState<NonNullable<ShopifyOrderCreateBody['financialStatus']>>('PENDING');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deliveryMethod, setDeliveryMethod] =
    useState<NonNullable<ShopifyOrderCreateBody['deliveryMethod']>>('shipping');
  /** Decimal string in shop currency; only applied when delivery is shipping. */
  const [shippingFeeInput, setShippingFeeInput] = useState('0');
  const [shipPresetId, setShipPresetId] = useState<string | null>(null);
  const [billPresetId, setBillPresetId] = useState<string | null>(null);

  /** When false, full shipping address is one summary line; all inputs when true. */
  const [shippingAddressEdit, setShippingAddressEdit] = useState(false);
  /** When false, full billing address is one summary line; all inputs when true. */
  const [billingAddressEdit, setBillingAddressEdit] = useState(false);

  const resetForm = useCallback(() => {
    setCustomerQuery('');
    setCustomerHits([]);
    setLastCustomerSearchQuery(null);
    setDebouncedCustomerQuery('');
    setSelectedCustomer(null);
    setAddr1('');
    setAddr2('');
    setCity('');
    setProvinceCode('');
    setZip('');
    setCountryCode('CA');
    setCompany('');
    setPhone('');
    setFirstName('');
    setLastName('');
    setBillingSameAsShipping(true);
    setBillAddr1('');
    setBillAddr2('');
    setBillCity('');
    setBillProvinceCode('');
    setBillZip('');
    setBillCountryCode('CA');
    setLines([]);
    setFinancialStatus('PENDING');
    setNote('');
    setDeliveryMethod('shipping');
    setShippingFeeInput('0');
    setShipPresetId(null);
    setBillPresetId(null);
    setShippingAddressEdit(false);
    setBillingAddressEdit(false);
  }, []);

  useEffect(() => {
    if (!open) {
      resetForm();
      return;
    }
    // Opening: addresses start in compact summary mode (use "Edit address" for inputs).
    setShippingAddressEdit(false);
    setBillingAddressEdit(false);
  }, [open, resetForm]);

  useEffect(() => {
    const q = customerQuery.trim();
    if (lastCustomerSearchQuery !== null && q !== lastCustomerSearchQuery) {
      setCustomerHits([]);
      setLastCustomerSearchQuery(null);
    }
  }, [customerQuery, lastCustomerSearchQuery]);

  useEffect(() => {
    const t = setTimeout(
      () => setDebouncedCustomerQuery(customerQuery.trim()),
      CUSTOMER_SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [customerQuery]);

  const runCustomerSearchForQuery = useCallback(async (q: string) => {
    if (q.length < 2) {
      setCustomerHits([]);
      setLastCustomerSearchQuery(null);
      return;
    }
    const seq = ++customerSearchSeqRef.current;
    setCustomerLoading(true);
    try {
      const res = await fetch(
        `/api/shopify/customers/search?q=${encodeURIComponent(q)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (seq !== customerSearchSeqRef.current) return;
      if (!res.ok) {
        toast.error(
          typeof data?.error === 'string'
            ? data.error
            : 'Customer search failed',
        );
        setCustomerHits([]);
        setLastCustomerSearchQuery(null);
        return;
      }
      setCustomerHits(Array.isArray(data.hits) ? data.hits : []);
      setLastCustomerSearchQuery(q);
    } catch {
      if (seq !== customerSearchSeqRef.current) return;
      toast.error('Customer search failed');
      setCustomerHits([]);
      setLastCustomerSearchQuery(null);
    } finally {
      if (seq === customerSearchSeqRef.current) {
        setCustomerLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!open || selectedCustomer) return;
    const q = debouncedCustomerQuery;
    if (q.length < 2) {
      customerSearchSeqRef.current += 1;
      setCustomerLoading(false);
      setCustomerHits([]);
      setLastCustomerSearchQuery(null);
      return;
    }
    void runCustomerSearchForQuery(q);
  }, [
    open,
    debouncedCustomerQuery,
    selectedCustomer,
    runCustomerSearchForQuery,
  ]);

  const runCustomerSearch = useCallback(() => {
    void runCustomerSearchForQuery(customerQuery.trim());
  }, [customerQuery, runCustomerSearchForQuery]);

  const applyCustomer = useCallback((node: ShopifyAdminCustomerNode) => {
    customerSearchSeqRef.current += 1;
    setCustomerLoading(false);
    setShipPresetId(null);
    setBillPresetId(null);
    setSelectedCustomer(node);
    const mail = pickCustomerAddress(node);
    let line1 = '';
    let line2 = '';
    let cityV = '';
    let provV = '';
    let zipV = '';
    let countryV = 'CA';
    let companyV = '';
    let phoneV = '';
    let fn = '';
    let ln = '';
    if (mail) {
      line1 = (mail.address1 ?? '').trim();
      line2 = (mail.address2 ?? '').trim();
      cityV = (mail.city ?? '').trim();
      provV = provinceCodeFromAddr(mail);
      zipV = (mail.zip ?? '').trim();
      countryV = toIso3166Alpha2CountryCode(mail.country, 'CA');
      companyV = (mail.company ?? '').trim();
      phoneV = (mail.phone ?? node.phone ?? '').trim();
      const nm = splitName(mail.name);
      fn = nm.firstName ?? (node.firstName ?? '').trim();
      ln = nm.lastName ?? (node.lastName ?? '').trim();
      setAddr1(line1);
      setAddr2(line2);
      setCity(cityV);
      setProvinceCode(provV);
      setZip(zipV);
      setCountryCode(countryV);
      setCompany(companyV);
      setPhone(phoneV);
      setFirstName(fn);
      setLastName(ln);
    } else {
      setAddr1('');
      setAddr2('');
      setCity('');
      setProvinceCode('');
      setZip('');
      setCountryCode('CA');
      setCompany('');
      phoneV = (node.phone ?? '').trim();
      setPhone(phoneV);
      fn = (node.firstName ?? '').trim();
      ln = (node.lastName ?? '').trim();
      setFirstName(fn);
      setLastName(ln);
      countryV = 'CA';
    }
    setShippingAddressEdit(
      !formatAddressSummaryLine({
        firstName: fn,
        lastName: ln,
        company: companyV,
        addr1: line1,
        addr2: line2,
        city: cityV,
        provinceCode: provV,
        zip: zipV,
        countryCode: countryV,
        phone: phoneV,
      }),
    );
  }, []);

  const onProductPick = useCallback((hit: ShopifyProductSearchHit) => {
    const label = `${hit.productTitle}${hit.variantTitle ? ` — ${hit.variantTitle}` : ''}`;
    setLines((prev) => [
      ...prev,
      {
        key: newKey(),
        kind: 'variant',
        variantGid: hit.variantId,
        label,
        sku: hit.sku,
        quantity: 1,
      },
    ]);
  }, []);

  const shippingPayload =
    useMemo((): ShopifyOrderCreateBody['shippingAddress'] => {
      return {
        address1: addr1.trim(),
        address2: addr2.trim(),
        city: city.trim(),
        zip: zip.trim(),
        countryCode: countryCode.trim().toUpperCase(),
        provinceCode: provinceCode.trim(),
        company: company.trim(),
        phone: phone.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      };
    }, [
      addr1,
      addr2,
      city,
      zip,
      countryCode,
      provinceCode,
      company,
      phone,
      firstName,
      lastName,
    ]);

  const billingPayload = useMemo(():
    | ShopifyOrderCreateBody['shippingAddress']
    | undefined => {
    if (billingSameAsShipping) return undefined;
    return {
      address1: billAddr1.trim(),
      address2: billAddr2.trim(),
      city: billCity.trim(),
      zip: billZip.trim(),
      countryCode: billCountryCode.trim().toUpperCase(),
      provinceCode: billProvinceCode.trim(),
      company: '',
      phone: '',
      firstName: '',
      lastName: '',
    };
  }, [
    billingSameAsShipping,
    billAddr1,
    billAddr2,
    billCity,
    billZip,
    billCountryCode,
    billProvinceCode,
  ]);

  const shippingSummaryLine = useMemo(
    () =>
      formatAddressSummaryLine({
        firstName,
        lastName,
        company,
        addr1,
        addr2,
        city,
        provinceCode,
        zip,
        countryCode,
        phone,
      }),
    [
      firstName,
      lastName,
      company,
      addr1,
      addr2,
      city,
      provinceCode,
      zip,
      countryCode,
      phone,
    ],
  );

  const billingSummaryLine = useMemo(
    () =>
      formatAddressSummaryLine({
        firstName: '',
        lastName: '',
        company: '',
        addr1: billAddr1,
        addr2: billAddr2,
        city: billCity,
        provinceCode: billProvinceCode,
        zip: billZip,
        countryCode: billCountryCode,
        phone: '',
      }),
    [
      billAddr1,
      billAddr2,
      billCity,
      billProvinceCode,
      billZip,
      billCountryCode,
    ],
  );

  const submit = useCallback(async () => {
    if (!selectedCustomer?.id) {
      toast.error('Select a Shopify customer');
      return;
    }
    if (!addr1.trim() || !city.trim() || !zip.trim()) {
      toast.error('Shipping address is incomplete');
      return;
    }
    if (!billingSameAsShipping) {
      if (!billAddr1.trim() || !billCity.trim() || !billZip.trim()) {
        toast.error('Billing address is incomplete');
        return;
      }
    }
    if (lines.length === 0) {
      toast.error('Add at least one line item');
      return;
    }

    const rawFee = shippingFeeInput.trim().replace(',', '.');
    const parsedFee = parseFloat(rawFee);
    const shippingFee =
      deliveryMethod === 'shipping' &&
      Number.isFinite(parsedFee) &&
      parsedFee >= 0
        ? parsedFee
        : 0;

    const body: ShopifyOrderCreateBody = {
      customerShopifyGid: selectedCustomer.id,
      shippingAddress: shippingPayload,
      billingAddress: billingPayload,
      lineItems: lines.map((row) => ({
        kind: 'variant' as const,
        variantGid: row.variantGid,
        quantity: row.quantity,
      })),
      deliveryMethod,
      shippingFee,
      financialStatus,
      note: note.trim() || null,
    };

    setSubmitting(true);
    try {
      const res = await fetch('/api/shopify/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof data?.error === 'string' ? data.error : 'Create order failed',
        );
        return;
      }
      toast.success(
        typeof data?.name === 'string' && data.name
          ? `Created ${data.name} in Shopify and synced.`
          : 'Order created in Shopify and synced.',
      );
      onOpenChange(false);
      onCreated?.();
    } catch {
      toast.error('Network error');
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedCustomer,
    addr1,
    city,
    zip,
    billingSameAsShipping,
    billAddr1,
    billCity,
    billZip,
    lines,
    shippingPayload,
    billingPayload,
    financialStatus,
    note,
    deliveryMethod,
    shippingFeeInput,
    onOpenChange,
    onCreated,
  ]);

  const customerQueryTrim = customerQuery.trim();
  const showCustomerHitList =
    lastCustomerSearchQuery !== null &&
    customerQueryTrim === lastCustomerSearchQuery;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              Create Shopify order
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 text-sm">
            <section className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Customer
              </div>
              {!selectedCustomer ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Name or email…"
                      value={customerQuery}
                      onChange={(e) => setCustomerQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void runCustomerSearch();
                      }}
                      aria-describedby={
                        !showCustomerHitList
                          ? 'shopify-customer-search-hint'
                          : undefined
                      }
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void runCustomerSearch()}
                    >
                      {customerLoading ? '…' : 'Search'}
                    </Button>
                  </div>
                  {!showCustomerHitList ? (
                    <p
                      id="shopify-customer-search-hint"
                      className="text-xs text-muted-foreground"
                    >
                      {customerQueryTrim.length < 2
                        ? 'Enter at least 2 characters to search.'
                        : 'Results update shortly after you stop typing. Use Search or Enter to run immediately.'}
                    </p>
                  ) : null}
                  {showCustomerHitList ? (
                    <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
                      {customerHits.length === 0 ? (
                        <div className="p-2 text-xs text-muted-foreground">
                          No customers match this search.
                        </div>
                      ) : (
                        customerHits.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="block w-full px-2 py-1.5 text-left text-xs hover:bg-muted/50"
                            onClick={() => applyCustomer(c)}
                          >
                            <span className="font-medium">
                              {c.displayName ??
                                [c.firstName, c.lastName]
                                  .filter(Boolean)
                                  .join(' ') ??
                                c.email}
                            </span>
                            {c.email ? (
                              <span className="ml-1 text-muted-foreground">
                                {c.email}
                              </span>
                            ) : null}
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-2 py-1.5 text-xs">
                  <span className="font-medium">
                    {selectedCustomer.displayName ??
                      [selectedCustomer.firstName, selectedCustomer.lastName]
                        .filter(Boolean)
                        .join(' ') ??
                      selectedCustomer.email}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-7 text-[10px]"
                    onClick={() => {
                      setSelectedCustomer(null);
                      setCustomerHits([]);
                      setLastCustomerSearchQuery(null);
                    }}
                  >
                    Change
                  </Button>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Shipping address
                </div>
                <Button
                  type="button"
                  variant={shippingAddressEdit ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  onClick={() => setShippingAddressEdit((v) => !v)}
                >
                  {shippingAddressEdit ? 'Done' : 'Edit address'}
                </Button>
              </div>
              <DeliveryLocationPresetPicker
                selectedPresetId={shipPresetId}
                onApply={({ presetId, poAddress, company }) => {
                  setShipPresetId(presetId);
                  setAddr1(poAddress.address1);
                  setAddr2(poAddress.address2 ?? '');
                  setCity(poAddress.city);
                  setProvinceCode(poAddress.province);
                  setZip(poAddress.postalCode);
                  setCountryCode(
                    (poAddress.country ?? 'CA').trim().toUpperCase() || 'CA',
                  );
                  if (company?.trim()) setCompany(company.trim());
                  setShippingAddressEdit(true);
                }}
                onClear={() => setShipPresetId(null)}
              />
              {!shippingAddressEdit ? (
                <button
                  type="button"
                  className="w-full min-h-9 rounded-md border border-input bg-muted/30 px-2.5 py-2 text-left text-xs leading-snug text-foreground transition-colors hover:bg-muted/50"
                  onClick={() => setShippingAddressEdit(true)}
                >
                  {shippingSummaryLine ? (
                    <span className="break-words">{shippingSummaryLine}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      No shipping address — click to edit
                    </span>
                  )}
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <Label className="text-xs">Address line 1</Label>
                    <Input
                      className="h-9"
                      value={addr1}
                      onChange={(e) => {
                        setShipPresetId(null);
                        setAddr1(e.target.value);
                      }}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Address line 2</Label>
                    <Input
                      className="h-9"
                      value={addr2}
                      onChange={(e) => {
                        setShipPresetId(null);
                        setAddr2(e.target.value);
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">City</Label>
                    <Input
                      className="h-9"
                      value={city}
                      onChange={(e) => {
                        setShipPresetId(null);
                        setCity(e.target.value);
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Province / state code</Label>
                    <Input
                      className="h-9"
                      placeholder="BC, ON, QC…"
                      value={provinceCode}
                      onChange={(e) => {
                        setShipPresetId(null);
                        setProvinceCode(e.target.value);
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Postal / ZIP</Label>
                    <Input
                      className="h-9"
                      value={zip}
                      onChange={(e) => {
                        setShipPresetId(null);
                        setZip(e.target.value);
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Country (ISO2)</Label>
                    <Input
                      className="h-9"
                      maxLength={2}
                      value={countryCode}
                      onChange={(e) => {
                        setShipPresetId(null);
                        setCountryCode(e.target.value.toUpperCase());
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Company</Label>
                    <Input
                      className="h-9"
                      value={company}
                      onChange={(e) => {
                        setShipPresetId(null);
                        setCompany(e.target.value);
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Phone</Label>
                    <Input
                      className="h-9"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">First name</Label>
                    <Input
                      className="h-9"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Last name</Label>
                    <Input
                      className="h-9"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={billingSameAsShipping}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setBillingSameAsShipping(checked);
                    if (checked) setBillPresetId(null);
                    if (!checked) {
                      setBillingAddressEdit(
                        !formatAddressSummaryLine({
                          firstName: '',
                          lastName: '',
                          company: '',
                          addr1: billAddr1,
                          addr2: billAddr2,
                          city: billCity,
                          provinceCode: billProvinceCode,
                          zip: billZip,
                          countryCode: billCountryCode,
                          phone: '',
                        }),
                      );
                    }
                  }}
                />
                Billing same as shipping
              </label>
              {!billingSameAsShipping ? (
                <div className="space-y-2 rounded-md border p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      Billing address
                    </div>
                    <Button
                      type="button"
                      variant={billingAddressEdit ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-8 shrink-0 text-xs"
                      onClick={() => setBillingAddressEdit((v) => !v)}
                    >
                      {billingAddressEdit ? 'Done' : 'Edit address'}
                    </Button>
                  </div>
                  <DeliveryLocationPresetPicker
                    selectedPresetId={billPresetId}
                    onApply={({ presetId, poAddress }) => {
                      setBillPresetId(presetId);
                      setBillAddr1(poAddress.address1);
                      setBillAddr2(poAddress.address2 ?? '');
                      setBillCity(poAddress.city);
                      setBillProvinceCode(poAddress.province);
                      setBillZip(poAddress.postalCode);
                      setBillCountryCode(
                        (poAddress.country ?? 'CA').trim().toUpperCase() ||
                          'CA',
                      );
                      setBillingAddressEdit(true);
                    }}
                    onClear={() => setBillPresetId(null)}
                  />
                  {!billingAddressEdit ? (
                    <button
                      type="button"
                      className="w-full min-h-9 rounded-md border border-input bg-muted/30 px-2.5 py-2 text-left text-xs leading-snug text-foreground transition-colors hover:bg-muted/50"
                      onClick={() => setBillingAddressEdit(true)}
                    >
                      {billingSummaryLine ? (
                        <span className="break-words">
                          {billingSummaryLine}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          No billing address — click to edit
                        </span>
                      )}
                    </button>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2">
                        <Label className="text-xs">
                          Billing address line 1
                        </Label>
                        <Input
                          className="h-9"
                          value={billAddr1}
                          onChange={(e) => {
                            setBillPresetId(null);
                            setBillAddr1(e.target.value);
                          }}
                        />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs">
                          Billing address line 2
                        </Label>
                        <Input
                          className="h-9"
                          value={billAddr2}
                          onChange={(e) => {
                            setBillPresetId(null);
                            setBillAddr2(e.target.value);
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">City</Label>
                        <Input
                          className="h-9"
                          value={billCity}
                          onChange={(e) => {
                            setBillPresetId(null);
                            setBillCity(e.target.value);
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Province code</Label>
                        <Input
                          className="h-9"
                          value={billProvinceCode}
                          onChange={(e) => {
                            setBillPresetId(null);
                            setBillProvinceCode(e.target.value);
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Postal / ZIP</Label>
                        <Input
                          className="h-9"
                          value={billZip}
                          onChange={(e) => {
                            setBillPresetId(null);
                            setBillZip(e.target.value);
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Country (ISO2)</Label>
                        <Input
                          className="h-9"
                          maxLength={2}
                          value={billCountryCode}
                          onChange={(e) => {
                            setBillPresetId(null);
                            setBillCountryCode(e.target.value.toUpperCase());
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </section>

            <section className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Delivery
              </div>
              <div className="flex flex-wrap gap-4 text-xs">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="shopify-office-delivery"
                    className="size-3.5 accent-primary"
                    checked={deliveryMethod === 'shipping'}
                    onChange={() => setDeliveryMethod('shipping')}
                  />
                  Shipping
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="shopify-office-delivery"
                    className="size-3.5 accent-primary"
                    checked={deliveryMethod === 'pickup'}
                    onChange={() => setDeliveryMethod('pickup')}
                  />
                  Pick up
                </label>
              </div>
              {deliveryMethod === 'shipping' ? (
                <div className="max-w-xs space-y-1">
                  <Label className="text-xs">Shipping fee</Label>
                  <Input
                    className="h-9"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={shippingFeeInput}
                    onChange={(e) => setShippingFeeInput(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Uses your Shopify store currency (same as the shop&apos;s
                    catalog prices).
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Pick up orders use a $0 &quot;Pick up&quot; delivery line;
                  line items are marked as not requiring shipment.
                </p>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Line items
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setProductPickOpen(true)}
                >
                  Add catalog item…
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Item</TableHead>
                    <TableHead className="w-24 text-xs">Qty</TableHead>
                    <TableHead className="w-20 text-right text-xs" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="text-xs text-muted-foreground"
                      >
                        No lines yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    lines.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="text-xs">
                          <div className="font-medium">{row.label}</div>
                          {row.sku ? (
                            <div className="text-muted-foreground">
                              {row.sku}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Input
                            className="h-8"
                            type="number"
                            min={1}
                            value={row.quantity}
                            onChange={(e) => {
                              const n = Math.max(
                                1,
                                parseInt(e.target.value, 10) || 1,
                              );
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.key === row.key ? { ...l, quantity: n } : l,
                                ),
                              );
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="h-7 text-[10px] text-destructive"
                            onClick={() =>
                              setLines((prev) =>
                                prev.filter((l) => l.key !== row.key),
                              )
                            }
                          >
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </section>

            <section className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Payment
              </div>
              <select
                className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2 text-xs"
                value={financialStatus}
                onChange={(e) =>
                  setFinancialStatus(e.target.value as 'PENDING' | 'PAID')
                }
              >
                <option value="PENDING">Pending (unpaid)</option>
                <option value="PAID">Paid</option>
              </select>
            </section>

            <section className="space-y-1">
              <Label className="text-xs">Order note (optional)</Label>
              <Textarea
                className="min-h-[4rem] text-xs"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={5000}
              />
            </section>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="gap-2"
              onClick={() => void submit()}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 shrink-0 animate-spin" />
                  Creating…
                </>
              ) : (
                'Create in Shopify & sync'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShopifyProductSearchDialog
        open={productPickOpen}
        onOpenChange={setProductPickOpen}
        onSelect={onProductPick}
        title="Add catalog line"
        debounceMs={280}
      />
    </>
  );
}
