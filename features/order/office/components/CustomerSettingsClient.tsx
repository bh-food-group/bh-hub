'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DeliveryLocationPresetPicker } from './DeliveryLocationPresetPicker';

export type Address = {
  address1: string;
  address2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
};

const EMPTY_ADDRESS: Address = {
  address1: '',
  address2: '',
  city: '',
  province: '',
  postalCode: '',
  country: 'CA',
};

const CA_PROVINCES = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' },
] as const;

function formatAddressOneLine(addr: Address): string {
  if (!addr.address1.trim()) return '—';
  const parts = [
    addr.address1,
    addr.address2,
    addr.city,
    addr.province,
    addr.postalCode,
  ].filter(Boolean);
  return parts.join(', ');
}

export type CustomerRow = {
  id: string;
  displayName: string | null;
  displayNameOverride: string | null;
  email: string | null;
  company: string | null;
  /** Short code for default PO numbers (e.g. MA in 6107 MA - …). */
  officePoAccountCode: string | null;
  shippingAddress: Address | null;
  billingAddress: Address | null;
  billingSameAsShipping: boolean;
  _count: { orders: number };
};

type Props = {
  customers: CustomerRow[];
};

/** Visible label: override → company → Shopify display name. */
function primaryCustomerLabel(c: CustomerRow): string {
  const o = c.displayNameOverride?.trim();
  if (o) return o;
  const comp = c.company?.trim();
  if (comp) return comp;
  return c.displayName?.trim() || '(unknown)';
}

function AddressFields({
  label,
  address,
  onChange,
}: {
  label: string;
  address: Address;
  onChange: (a: Address) => void;
}) {
  const set = useCallback(
    (field: keyof Address, val: string) => onChange({ ...address, [field]: val }),
    [address, onChange],
  );

  return (
    <fieldset className="space-y-1.5">
      {label ? <legend className="text-xs font-medium">{label}</legend> : null}
      <Input
        value={address.address1}
        onChange={(e) => set('address1', e.target.value)}
        className="h-7 text-xs"
        placeholder="Address line 1"
      />
      <Input
        value={address.address2 ?? ''}
        onChange={(e) => set('address2', e.target.value)}
        className="h-7 text-xs"
        placeholder="Address line 2 (optional)"
      />
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          value={address.city}
          onChange={(e) => set('city', e.target.value)}
          className="h-7 text-xs"
          placeholder="City"
        />
        <Select value={address.province} onValueChange={(v) => set('province', v)}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Province" />
          </SelectTrigger>
          <SelectContent>
            {CA_PROVINCES.map((p) => (
              <SelectItem key={p.code} value={p.code}>
                {p.code} — {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          value={address.postalCode}
          onChange={(e) => set('postalCode', e.target.value)}
          className="h-7 text-xs"
          placeholder="Postal code"
        />
        <Input
          value={address.country}
          onChange={(e) => set('country', e.target.value)}
          className="h-7 text-xs"
          placeholder="Country"
          readOnly
        />
      </div>
    </fieldset>
  );
}

export function CustomerSettingsClient({ customers }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [value, setValue] = useState('');
  const [companyValue, setCompanyValue] = useState('');
  const [poAccountCode, setPoAccountCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [shippingAddr, setShippingAddr] = useState<Address>(EMPTY_ADDRESS);
  const [shippingAddrEditOpen, setShippingAddrEditOpen] = useState(false);
  const [billingAddr, setBillingAddr] = useState<Address>(EMPTY_ADDRESS);
  const [billingSame, setBillingSame] = useState(true);
  const [billingPresetId, setBillingPresetId] = useState<string | null>(null);

  function openEdit(c: CustomerRow) {
    setEditing(c);
    setValue(c.displayNameOverride ?? '');
    setCompanyValue(c.company ?? '');
    setPoAccountCode(c.officePoAccountCode?.trim() ?? '');
    setShippingAddr((c.shippingAddress as Address) ?? { ...EMPTY_ADDRESS });
    setShippingAddrEditOpen(false);
    setBillingAddr((c.billingAddress as Address) ?? { ...EMPTY_ADDRESS });
    setBillingSame(c.billingSameAsShipping);
    setBillingPresetId(null);
  }

  const filtered = search
    ? customers.filter((c) => {
        const q = search.toLowerCase();
        return (
          primaryCustomerLabel(c).toLowerCase().includes(q) ||
          (c.email ?? '').toLowerCase().includes(q) ||
          (c.displayNameOverride ?? '').toLowerCase().includes(q) ||
          (c.company ?? '').toLowerCase().includes(q) ||
          (c.officePoAccountCode ?? '').toLowerCase().includes(q) ||
          (c.displayName ?? '').toLowerCase().includes(q)
        );
      })
    : customers;

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { displayNameOverride: value };
      if (companyValue !== (editing.company ?? '')) {
        payload.company = companyValue;
      }
      if (poAccountCode.trim() !== (editing.officePoAccountCode?.trim() ?? '')) {
        payload.officePoAccountCode = poAccountCode.trim();
      }
      const hasShipping = shippingAddr.address1.trim().length > 0;
      payload.shippingAddress = hasShipping ? shippingAddr : null;
      payload.billingSameAsShipping = billingSame;
      payload.billingAddress = billingSame ? null : (billingAddr.address1.trim().length > 0 ? billingAddr : null);

      const res = await fetch(`/api/shopify/customers/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setEditing(null);
        router.refresh();
      }
    } catch (err) {
      console.error('Failed to update customer:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/shopify/customers/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayNameOverride: '' }),
      });
      if (res.ok) {
        setEditing(null);
        router.refresh();
      }
    } catch (err) {
      console.error('Failed to reset customer name:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Customers ({customers.length})
          </h2>
          <Input
            placeholder="Search customers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 w-[220px] text-xs px-2"
          />
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {search ? 'No customers match your search.' : 'No customers found.'}
          </p>
        ) : (
          <div className="relative w-full overflow-auto rounded-md border">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="border-b transition-colors hover:bg-muted/50">
                  {['Display Name', 'Email', 'Company', 'PO code', 'Orders', ''].map(
                    (h, i) => (
                      <th
                        key={`${h}-${i}`}
                        className="h-9 px-3 text-left align-middle text-xs font-medium text-muted-foreground"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {filtered.map((c) => {
                  const name = primaryCustomerLabel(c);
                  const hasOverride = !!c.displayNameOverride?.trim();

                  return (
                    <tr
                      key={c.id}
                      className="border-b transition-colors hover:bg-muted/50"
                    >
                      <td className="p-3 align-middle font-medium">
                        <span>{name}</span>
                        {hasOverride && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground/60">
                            (custom)
                          </span>
                        )}
                      </td>
                      <td className="p-3 align-middle text-xs text-muted-foreground">
                        {c.email ?? '—'}
                      </td>
                      <td className="p-3 align-middle text-xs text-muted-foreground">
                        {c.company ?? '—'}
                      </td>
                      <td className="p-3 align-middle text-xs font-mono text-muted-foreground">
                        {c.officePoAccountCode?.trim() || '—'}
                      </td>
                      <td className="p-3 align-middle text-right tabular-nums text-xs">
                        {c._count.orders}
                      </td>
                      <td className="p-3 align-middle">
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-[10px]"
                          onClick={() => openEdit(c)}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setShippingAddrEditOpen(false);
            setBillingPresetId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                {editing.email && <span>{editing.email}</span>}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Display Name Override</label>
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="h-8 text-sm"
                  placeholder={editing.displayName ?? 'Enter display name…'}
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Company</label>
                <Input
                  value={companyValue}
                  onChange={(e) => setCompanyValue(e.target.value)}
                  className="h-8 text-sm"
                  placeholder="Company name"
                />
                <p className="text-[10px] text-muted-foreground">
                  Synced with Shopify
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">PO account code</label>
                <Input
                  value={poAccountCode}
                  onChange={(e) => setPoAccountCode(e.target.value)}
                  className="h-8 text-sm font-mono"
                  placeholder="e.g. MA"
                  maxLength={40}
                />
                <p className="text-[10px] text-muted-foreground">
                  Short token in suggested PO numbers (e.g. 6107 MA - Millda). Hub only,
                  not sent to Shopify.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Shopify Name
                </label>
                <div className="text-sm text-muted-foreground/70 px-2">
                  {editing.displayName ?? '(none)'}
                </div>
              </div>

              <hr className="my-2" />

              <div className="space-y-1.5">
                <DeliveryLocationPresetPicker
                  compact
                  className="pb-0.5"
                  onApply={({ poAddress, company: presetCompany }) => {
                    setShippingAddr({
                      address1: poAddress.address1,
                      address2: poAddress.address2 ?? '',
                      city: poAddress.city,
                      province: poAddress.province,
                      postalCode: poAddress.postalCode,
                      country: (poAddress.country ?? 'CA').trim() || 'CA',
                    });
                    if (presetCompany?.trim()) {
                      setCompanyValue(presetCompany.trim());
                    }
                    setShippingAddrEditOpen(true);
                  }}
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium">Default Shipping Address</label>
                  {shippingAddrEditOpen ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                      title="Close address editor"
                      onClick={() => setShippingAddrEditOpen(false)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                      title="Edit shipping address"
                      onClick={() => setShippingAddrEditOpen(true)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {shippingAddrEditOpen ? (
                  <AddressFields
                    label=""
                    address={shippingAddr}
                    onChange={setShippingAddr}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground leading-snug px-0.5">
                    {formatAddressOneLine(shippingAddr)}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="billing-same"
                  checked={billingSame}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setBillingSame(next);
                    if (next) setBillingPresetId(null);
                  }}
                  className="h-3.5 w-3.5 rounded border-gray-300"
                />
                <label htmlFor="billing-same" className="text-xs">
                  Billing address same as shipping
                </label>
              </div>

              {!billingSame && (
                <div className="space-y-1.5">
                  <DeliveryLocationPresetPicker
                    compact
                    className="pb-0.5"
                    selectedPresetId={billingPresetId}
                    onApply={({ presetId, poAddress }) => {
                      setBillingPresetId(presetId);
                      setBillingAddr({
                        address1: poAddress.address1,
                        address2: poAddress.address2 ?? '',
                        city: poAddress.city,
                        province: poAddress.province,
                        postalCode: poAddress.postalCode,
                        country:
                          (poAddress.country ?? 'CA').trim().toUpperCase() ||
                          'CA',
                      });
                    }}
                    onClear={() => setBillingPresetId(null)}
                  />
                  <AddressFields
                    label="Default Billing Address"
                    address={billingAddr}
                    onChange={(a) => {
                      setBillingPresetId(null);
                      setBillingAddr(a);
                    }}
                  />
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  disabled={saving}
                  className="flex-1 text-xs"
                  onClick={handleSave}
                >
                  Save
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  className="text-xs"
                  onClick={handleReset}
                >
                  Reset to Shopify
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
