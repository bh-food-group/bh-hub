'use client';

import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import {
  legacyFallbackOrderChannel,
  normalizeSupplierEmailContacts,
  normalizeSupplierContactEmails,
  type SupplierOrderChannelType,
  type EmailOrderChannelPayload,
  type OrderLinkChannelPayload,
  type DirectInstructionChannelPayload,
} from '@/lib/order/supplier-order-channel';
import type { SupplierDeliverySchedule } from '@/lib/order/supplier-delivery-schedule';
import { SupplierDeliveryScheduleFields } from './SupplierDeliveryScheduleFields';
import { useSupplierDeliveryScheduleForm } from '../hooks/use-supplier-delivery-schedule-form';

type EmailFormRow = { email: string; name: string };
type CcFormRow = { email: string };

export type SupplierGroup = {
  id: string;
  name: string;
  slug: string;
  _count: { suppliers: number };
};

export type VendorMappingRow = { id: string; vendorName: string };

export type SupplierRow = {
  id: string;
  company: string;
  officePoSupplierCode: string | null;
  shopifyVendorName: string | null;
  groupId: string | null;
  group: { name: string; slug: string } | null;
  contactName: string | null;
  contactEmails: string[];
  isFavorite: boolean;
  link: string | null;
  notes: string | null;
  orderChannelType: string;
  orderChannelPayload: unknown;
  deliverySchedule: unknown | null;
  createdAt: string;
  vendorMappings: VendorMappingRow[];
  _count: { purchaseOrders: number };
};

type Props = {
  editing: SupplierRow | null;
  prefillVendor: string | null;
  vendors: string[];
  groups: SupplierGroup[];
  defaultGroupId?: string | null;
  onDone: () => void;
};

const NONE_VALUE = '__none__';

const CHANNEL_OPTIONS: {
  value: SupplierOrderChannelType;
  label: string;
}[] = [
  { value: 'email', label: 'Email' },
  { value: 'order_link', label: 'Order link' },
  { value: 'direct_instruction', label: 'Direct' },
];

function initialOrderChannel(editing: SupplierRow | null) {
  const emptyEmailRow = (): EmailFormRow => ({ email: '', name: '' });
  const emptyCcRow = (): CcFormRow => ({ email: '' });
  if (!editing) {
    return {
      orderChannelType: 'email' as SupplierOrderChannelType,
      email: { rows: [emptyEmailRow()], ccRows: [emptyCcRow()] },
      link: {
        orderUrl: '',
        invoiceConfirmSenderEmail: '',
      },
      instruction: '',
    };
  }
  const { type, payload } = legacyFallbackOrderChannel({
    orderChannelType: editing.orderChannelType,
    orderChannelPayload: editing.orderChannelPayload,
    contactEmails: editing.contactEmails,
    contactName: editing.contactName,
    link: editing.link,
    notes: editing.notes,
  });
  if (type === 'email') {
    const p = payload as EmailOrderChannelPayload;
    const rows: EmailFormRow[] =
      p.contacts.length > 0
        ? p.contacts.map((c) => ({
            email: c.email,
            name: c.name?.trim() ?? '',
          }))
        : [emptyEmailRow()];
    const ccList = normalizeSupplierContactEmails(p.ccEmails ?? []);
    const ccRows: CcFormRow[] =
      ccList.length > 0 ? ccList.map((email) => ({ email })) : [emptyCcRow()];
    return {
      orderChannelType: type,
      email: { rows, ccRows },
      link: { orderUrl: '', invoiceConfirmSenderEmail: '' },
      instruction: p.instruction ?? '',
    };
  }
  if (type === 'order_link') {
    const p = payload as OrderLinkChannelPayload;
    return {
      orderChannelType: type,
      email: { rows: [emptyEmailRow()], ccRows: [emptyCcRow()] },
      link: {
        orderUrl: p.orderUrl ?? '',
        invoiceConfirmSenderEmail: p.invoiceConfirmSenderEmail ?? '',
      },
      instruction: p.instruction ?? '',
    };
  }
  const p = payload as DirectInstructionChannelPayload;
  return {
    orderChannelType: type,
    email: { rows: [emptyEmailRow()], ccRows: [emptyCcRow()] },
    link: { orderUrl: '', invoiceConfirmSenderEmail: '' },
    instruction: p.instruction ?? '',
  };
}

export function SupplierForm({
  editing,
  prefillVendor,
  vendors,
  groups,
  defaultGroupId,
  onDone,
}: Props) {
  const isEdit = editing !== null;
  const [isPending, startTransition] = useTransition();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const [company, setCompany] = useState(
    editing?.company ?? prefillVendor ?? '',
  );
  const [officePoSupplierCode, setOfficePoSupplierCode] = useState(
    editing?.officePoSupplierCode?.trim() ?? '',
  );
  const [shopifyVendorName, setShopifyVendorName] = useState(
    editing?.shopifyVendorName ?? prefillVendor ?? '',
  );
  const [groupId, setGroupId] = useState(
    editing?.groupId ?? defaultGroupId ?? '',
  );
  const ic = useMemo(() => initialOrderChannel(editing), [editing]);
  const [instruction, setInstruction] = useState(ic.instruction);
  const [error, setError] = useState<string | null>(null);
  const [orderChannelType, setOrderChannelType] =
    useState<SupplierOrderChannelType>(ic.orderChannelType);
  const [emailRows, setEmailRows] = useState<EmailFormRow[]>(ic.email.rows);
  const [ccEmailRows, setCcEmailRows] = useState<CcFormRow[]>(ic.email.ccRows);
  const [linkOrderUrl, setLinkOrderUrl] = useState(ic.link.orderUrl);
  const [linkInvoiceEmail, setLinkInvoiceEmail] = useState(
    ic.link.invoiceConfirmSenderEmail,
  );

  const [vendorAliases, setVendorAliases] = useState<string[]>(
    editing?.vendorMappings.map((m) => m.vendorName) ?? [],
  );
  const [newAlias, setNewAlias] = useState('');

  const deliveryForm = useSupplierDeliveryScheduleForm(editing?.deliverySchedule);

  function addAlias() {
    const trimmed = newAlias.trim();
    if (!trimmed || vendorAliases.includes(trimmed)) return;
    setVendorAliases((prev) => [...prev, trimmed]);
    setNewAlias('');
  }

  function removeAlias(name: string) {
    setVendorAliases((prev) => prev.filter((a) => a !== name));
  }

  function addEmailRow() {
    setEmailRows((prev) => [...prev, { email: '', name: '' }]);
  }

  function removeEmailRow(index: number) {
    setEmailRows((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );
  }

  function addCcRow() {
    setCcEmailRows((prev) => [...prev, { email: '' }]);
  }

  function removeCcRow(index: number) {
    setCcEmailRows((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );
  }

  function patchCcRow(index: number, patch: Partial<CcFormRow>) {
    setCcEmailRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function patchEmailRow(
    index: number,
    patch: Partial<Pick<EmailFormRow, 'email' | 'name'>>,
  ) {
    setEmailRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function buildPayload(): unknown {
    if (orderChannelType === 'email') {
      const ccEmails = normalizeSupplierContactEmails(
        ccEmailRows.map((r) => r.email),
      );
      return {
        contacts: normalizeSupplierEmailContacts(
          emailRows.map((r) => ({
            email: r.email,
            name: r.name.trim() || null,
          })),
        ),
        ccEmails,
        instruction: instruction.trim(),
      };
    }
    if (orderChannelType === 'order_link') {
      return {
        orderUrl: linkOrderUrl.trim() || null,
        instruction: instruction.trim(),
        invoiceConfirmSenderEmail: linkInvoiceEmail.trim() || null,
      };
    }
    return { instruction: instruction.trim() };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const scheduleErr = deliveryForm.validateScheduleForSubmit();
      if (scheduleErr) {
        setError(scheduleErr);
        return;
      }

      const schedulePayload = deliveryForm.buildDeliverySchedulePayload();

      const body = {
        company: company.trim(),
        officePoSupplierCode: officePoSupplierCode.trim() || null,
        shopifyVendorName: shopifyVendorName.trim() || null,
        groupId: groupId || null,
        instruction: instruction.trim() || null,
        orderChannelType,
        orderChannelPayload: buildPayload(),
        vendorAliases,
        deliverySchedule: schedulePayload,
      };

      const url = isEdit ? `/api/order/suppliers/${editing.id}` : '/api/order/suppliers';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Failed (${res.status})`);
        return;
      }

      onDone();
    });
  }

  const fieldCls =
    'h-auto min-h-0 text-sm px-2 py-1.5 rounded-md md:text-sm';

  const poCount = editing?._count.purchaseOrders ?? 0;
  const canDelete = isEdit && poCount === 0;

  return (
    <form
      key={editing?.id ?? 'new-supplier'}
      onSubmit={handleSubmit}
      className="space-y-3"
    >
      <h3 className="text-sm font-semibold">
        {isEdit ? 'Edit Supplier' : 'Create Supplier'}
      </h3>

      {error && (
        <p className="text-sm text-destructive rounded bg-destructive/10 px-2 py-1">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="sf-company" className="text-xs">
            Company *
          </Label>
          <Input
            id="sf-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            required
            className={fieldCls}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="sf-group" className="text-xs">
            Group
          </Label>
          <Select
            value={groupId || NONE_VALUE}
            onValueChange={(v) => setGroupId(v === NONE_VALUE ? '' : v)}
          >
            <SelectTrigger
              id="sf-group"
              className="h-auto min-h-0 text-sm px-2 py-1.5"
            >
              <SelectValue placeholder="Select group..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>
                <span className="text-muted-foreground">None</span>
              </SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="sf-po-supplier-code" className="text-xs">
          PO supplier code (optional)
        </Label>
        <Input
          id="sf-po-supplier-code"
          value={officePoSupplierCode}
          onChange={(e) => setOfficePoSupplierCode(e.target.value)}
          placeholder="e.g. Millda"
          maxLength={40}
          className={fieldCls}
        />
        <p className="text-[10px] text-muted-foreground leading-snug">
          Suggested PO numbers use this code; if empty, the company name is used (not
          the supplier group).
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="sf-vendor" className="text-xs">
          Shopify Vendor
        </Label>
        <Select
          value={shopifyVendorName || NONE_VALUE}
          onValueChange={(v) =>
            setShopifyVendorName(v === NONE_VALUE ? '' : v)
          }
        >
          <SelectTrigger
            id="sf-vendor"
            className="h-auto min-h-0 text-sm px-2 py-1.5"
          >
            <SelectValue placeholder="Select vendor..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>
              <span className="text-muted-foreground">None</span>
            </SelectItem>
            {vendors.map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isEdit && (
        <div className="grid gap-2">
          <Label className="text-xs">Vendor Aliases</Label>
          <p className="text-[10px] text-muted-foreground -mt-1">
            Map multiple Shopify vendor names to this supplier (handles renames).
          </p>
          {vendorAliases.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {vendorAliases.map((alias) => (
                <span
                  key={alias}
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
                >
                  {alias}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground text-[10px] leading-none cursor-pointer"
                    onClick={() => removeAlias(alias)}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <Input
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              placeholder="Add vendor name alias..."
              className={fieldCls}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addAlias();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs shrink-0"
              onClick={addAlias}
            >
              Add
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <Label className="text-xs">Order method</Label>
        <div className="flex flex-wrap gap-1">
          {CHANNEL_OPTIONS.map((o) => (
            <Button
              key={o.value}
              type="button"
              size="sm"
              variant={orderChannelType === o.value ? 'default' : 'outline'}
              className={cn(
                'text-xs h-auto py-1',
                orderChannelType !== o.value && 'text-muted-foreground',
              )}
              onClick={() => setOrderChannelType(o.value)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      </div>

      {orderChannelType === 'email' && (
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label className="text-xs">Contacts *</Label>
            <p className="text-[10px] text-muted-foreground -mt-1">
              One name per email (invalid / duplicate emails are removed on save).
            </p>
            {emailRows.map((row, index) => (
              <div
                key={index}
                className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-1.5 items-end"
              >
                <div className="grid gap-1">
                  <Label className="text-[10px] text-muted-foreground">
                    Email
                  </Label>
                  <Input
                    id={index === 0 ? 'sf-email-0' : undefined}
                    type="email"
                    value={row.email}
                    onChange={(e) =>
                      patchEmailRow(index, { email: e.target.value })
                    }
                    placeholder="supplier@example.com"
                    className={fieldCls}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[10px] text-muted-foreground">
                    Name
                  </Label>
                  <Input
                    value={row.name}
                    onChange={(e) =>
                      patchEmailRow(index, { name: e.target.value })
                    }
                    placeholder="Contact name"
                    className={fieldCls}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs shrink-0 px-2 h-8 sm:mb-0.5"
                  onClick={() => removeEmailRow(index)}
                  disabled={emailRows.length <= 1}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs w-fit"
              onClick={addEmailRow}
            >
              Add contact
            </Button>
          </div>
          <div className="grid gap-2">
            <Label className="text-xs">CC</Label>
            <p className="text-[10px] text-muted-foreground -mt-1">
              Optional. Included on PO emails with office-wide CC (invalid /
              duplicate addresses removed on save; not sent as To).
            </p>
            {ccEmailRows.map((row, index) => (
              <div
                key={index}
                className="flex flex-col sm:flex-row gap-1.5 items-stretch sm:items-end"
              >
                <div className="grid gap-1 flex-1 min-w-0">
                  <Label className="text-[10px] text-muted-foreground">
                    Email
                  </Label>
                  <Input
                    type="email"
                    value={row.email}
                    onChange={(e) =>
                      patchCcRow(index, { email: e.target.value })
                    }
                    placeholder="cc@example.com"
                    className={fieldCls}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs shrink-0 px-2 h-8 sm:mb-0.5 self-end"
                  onClick={() => removeCcRow(index)}
                  disabled={ccEmailRows.length <= 1}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs w-fit"
              onClick={addCcRow}
            >
              Add CC
            </Button>
          </div>
        </div>
      )}

      {orderChannelType === 'order_link' && (
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="sf-order-url" className="text-xs">
              Order URL *
            </Label>
            <Input
              id="sf-order-url"
              type="url"
              placeholder="https://…"
              value={linkOrderUrl}
              onChange={(e) => setLinkOrderUrl(e.target.value)}
              className={fieldCls}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sf-invoice-email" className="text-xs">
              Invoice confirm email
            </Label>
            <Input
              id="sf-invoice-email"
              type="email"
              placeholder="Who sends / receives invoice confirmation"
              value={linkInvoiceEmail}
              onChange={(e) => setLinkInvoiceEmail(e.target.value)}
              className={fieldCls}
            />
          </div>
        </div>
      )}

      {orderChannelType === 'direct_instruction' && (
        <div className="text-[10px] text-muted-foreground">
          Use instruction below for direct ordering guidance.
        </div>
      )}

      <SupplierDeliveryScheduleFields
        form={deliveryForm}
        radioName="sf-delivery-rule"
      />

      <div className="grid gap-2">
        <Label htmlFor="sf-instruction" className="text-xs">
          Instructions
        </Label>
        <Textarea
          id="sf-instruction"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          className="min-h-16 resize-none text-sm px-2 py-1.5 md:text-sm"
          placeholder="Shown in Inbox and PO order processing for this supplier."
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDone}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
        {isEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10"
            disabled={isPending || !canDelete}
            title={
              !canDelete
                ? `This supplier has ${poCount} purchase order${poCount !== 1 ? 's' : ''} and cannot be deleted.`
                : 'Permanently remove this supplier and its vendor mappings'
            }
            onClick={() => {
              setError(null);
              setDeleteConfirmOpen(true);
            }}
          >
            Delete supplier
          </Button>
        )}
      </div>

      {editing && (
        <ConfirmDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          title="Delete this supplier?"
          description={`Remove “${editing.company}” from the hub. Shopify vendor aliases for this supplier will be removed. This cannot be undone.`}
          variant="destructive"
          confirmLabel="Delete"
          onConfirm={async () => {
            const res = await fetch(`/api/order/suppliers/${editing.id}`, {
              method: 'DELETE',
            });
            if (!res.ok) {
              const data = (await res.json().catch(() => null)) as {
                error?: string;
              } | null;
              const msg = data?.error ?? `Delete failed (${res.status})`;
              setError(msg);
              throw new Error(msg);
            }
            setDeleteConfirmOpen(false);
            onDone();
          }}
        />
      )}
    </form>
  );
}
