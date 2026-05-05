'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { YmdDateInput } from '@/components/ui/ymd-date-input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { formatShopifyOrderDisplayFulfillmentStatus } from '@/types/shopify';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  SupplierKey,
  SupplierEntry,
  PoPanelMeta,
  LinkedShopifyOrder,
  PoAddress,
  OfficePurchaseOrderBlock,
  PurchaseOrderStatus,
} from '../types';
import {
  buildPoPdfInput,
  downloadPoPdf,
  openPoPdfPrint,
} from '../utils/purchase-order-pdf';
import {
  MetaPoNumberInput,
  type MetaPoNumberFieldError,
} from './MetaPoNumberInput';
import { DeliveryLocationPresetPicker } from './DeliveryLocationPresetPicker';
import { postSendPurchaseOrderEmail } from '../utils/post-send-po-email';
import { Spinner } from '@/components/ui/spinner';

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

const EMPTY_ADDR: PoAddress = {
  address1: '',
  address2: '',
  city: '',
  province: '',
  postalCode: '',
  country: 'CA',
};

export type CreatePoPayload = {
  expectedDate: string | null;
  comment: string | null;
  shippingAddress: PoAddress | null;
  billingAddress: PoAddress | null;
  billingSameAsShipping: boolean;
  deliveryLocationPresetId?: string | null;
  /** Create PO with hub `pending` status (inbox → PO Pending tab only). */
  hubPending?: boolean;
};

export type EditPoFields = {
  expectedDate?: string | null;
  comment?: string | null;
  poNumber?: string;
  status?: PurchaseOrderStatus;
  shippingAddress?: PoAddress | null;
  billingAddress?: PoAddress | null;
  billingSameAsShipping?: boolean;
  deliveryLocationPresetId?: string | null;
};

export type EditPoResult =
  | { ok: true }
  | { ok: false; reason: 'duplicate_po_number' | 'unknown' };

type Props = {
  entry: SupplierEntry;
  activeKey: SupplierKey;
  /** Default `expectedDate` when creating a PO from inbox drafts (Vancouver YMD). */
  defaultExpectedYmd: string;
  /**
   * Min allowed expected date for draft “Create PO” (latest order day among included drafts).
   * Passed to date input `min`; null = no constraint.
   */
  minExpectedYmdForDrafts?: string | null;
  onCreatePo: (
    key: SupplierKey,
    payload?: CreatePoPayload,
  ) => Promise<EditPoResult>;
  onEditPo: (poId: string, fields: EditPoFields) => Promise<EditPoResult>;
  onDeletePo: (poId: string) => void;
  /** After successful PO outbound email — parent patches view data optimistically. */
  onPoEmailSent?: (poId: string) => void;
  /** Persist “do not send” / undo waive (PUT purchase order). */
  onPoEmailDeliveryWaivedChange?: (
    poId: string,
    waived: boolean,
  ) => void | Promise<void>;
  poPanelMeta?: PoPanelMeta;
  selectedPoBlockId?: string | null;
  onArchive?: (key: SupplierKey) => void;
  onArchivePurchaseOrder?: (poId: string) => void;
  onUnarchive?: (key: SupplierKey) => void;
  /** Provided only when the active inbox entry is a replacement order. */
  onDeleteReplacementOrder?: () => void | Promise<void>;
  draftPoNumber?: string;
  poNumberIsManual?: boolean;
  onPoNumberChange?: (value: string) => void;
  onPoNumberReset?: () => void;
  customerDefaultShipping?: PoAddress | null;
  customerDefaultBilling?: PoAddress | null;
  customerBillingSameAsShipping?: boolean;
  /** Block selected in the post-PO view — used for Print PO. */
  poPrintBlock?: OfficePurchaseOrderBlock | null;
  /** Customer company headline for the PDF (billing = shipping in most cases). */
  poPrintHeadline?: string | null;
  /** Line items are being lazy-loaded — disable actions that depend on them. */
  lineItemsLoading?: boolean;
  /** Inbox Shopify order ids shown for this supplier row (non-archived drafts). */
  inboxShopifyOrderIds?: string[];
};

export function MetaPanel({
  entry,
  activeKey,
  defaultExpectedYmd,
  minExpectedYmdForDrafts,
  onCreatePo,
  onEditPo,
  onDeletePo,
  onPoEmailSent,
  onPoEmailDeliveryWaivedChange,
  poPanelMeta,
  selectedPoBlockId,
  onArchive,
  onArchivePurchaseOrder,
  onUnarchive,
  onDeleteReplacementOrder,
  draftPoNumber,
  poNumberIsManual,
  onPoNumberChange,
  onPoNumberReset,
  customerDefaultShipping,
  customerDefaultBilling,
  customerBillingSameAsShipping,
  poPrintBlock,
  poPrintHeadline,
  lineItemsLoading,
  inboxShopifyOrderIds,
}: Props) {
  return (
    <div className="w-[192px] flex-shrink-0 border-l bg-background flex flex-col overflow-y-auto">
      {!entry.poCreated || selectedPoBlockId === '__drafts__' ? (
        <WithoutPoMeta
          entry={entry}
          activeKey={activeKey}
          defaultExpectedYmd={defaultExpectedYmd}
          minExpectedYmd={minExpectedYmdForDrafts ?? null}
          onCreatePo={onCreatePo}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onDeleteReplacementOrder={onDeleteReplacementOrder}
          draftPoNumber={draftPoNumber}
          poNumberIsManual={poNumberIsManual}
          onPoNumberChange={onPoNumberChange}
          onPoNumberReset={onPoNumberReset}
          customerDefaultShipping={customerDefaultShipping}
          customerDefaultBilling={customerDefaultBilling}
          customerBillingSameAsShipping={customerBillingSameAsShipping}
          inboxShopifyOrderIds={inboxShopifyOrderIds}
        />
      ) : (
        <WithPoMeta
          entry={entry}
          poPanelMeta={poPanelMeta}
          selectedPoBlockId={selectedPoBlockId}
          onEditPo={onEditPo}
          onDeletePo={onDeletePo}
          onPoEmailSent={onPoEmailSent}
          onPoEmailDeliveryWaivedChange={onPoEmailDeliveryWaivedChange}
          activeKey={activeKey}
          onArchivePurchaseOrder={onArchivePurchaseOrder}
          onUnarchive={onUnarchive}
          poPrintBlock={poPrintBlock}
          poPrintHeadline={poPrintHeadline}
          customerDefaultBilling={customerDefaultBilling}
          customerDefaultShipping={customerDefaultShipping}
          lineItemsLoading={lineItemsLoading}
        />
      )}
    </div>
  );
}

// ─── Section primitives ───────────────────────────────────────────────────────

function Section({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2.5 border-b">{children}</div>;
}

function MetaLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
      {children}
    </div>
  );
}

function MetaValue({
  children,
  mono,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      className={cn(
        'text-[12px] text-foreground',
        mono && 'font-mono text-[10px] leading-relaxed break-all',
      )}
    >
      {children}
    </div>
  );
}

function MetaSub({
  children,
  red,
}: {
  children: React.ReactNode;
  red?: boolean;
}) {
  return (
    <div
      className={cn(
        'text-[10px]',
        red ? 'text-[#A32D2D]' : 'text-muted-foreground',
      )}
    >
      {children}
    </div>
  );
}

function FieldInput({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </Label>
      {children}
    </div>
  );
}

// ─── Address helpers ──────────────────────────────────────────────────────────

function isAddrEmpty(a: PoAddress | null | undefined): boolean {
  if (!a) return true;
  return !a.address1.trim();
}

function formatAddrOneLine(a: PoAddress | null | undefined): string {
  if (!a || !a.address1.trim()) return '—';
  const parts = [
    a.address1,
    a.address2,
    a.city,
    a.province,
    a.postalCode,
  ].filter(Boolean);
  return parts.join(', ');
}

function CompactAddressInput({
  label,
  address,
  onChange,
}: {
  label: string;
  address: PoAddress;
  onChange: (a: PoAddress) => void;
}) {
  const set = (field: keyof PoAddress, val: string) =>
    onChange({ ...address, [field]: val });
  const cls =
    'h-auto min-h-0 text-[11px] px-1.5 py-[3px] rounded-[5px] md:text-[11px]';

  return (
    <div className="flex flex-col gap-1">
      {label ? <MetaLabel>{label}</MetaLabel> : null}
      <Input
        value={address.address1}
        onChange={(e) => set('address1', e.target.value)}
        className={cls}
        placeholder="Address 1"
      />
      <Input
        value={address.address2 ?? ''}
        onChange={(e) => set('address2', e.target.value)}
        className={cls}
        placeholder="Address 2"
      />
      <Input
        value={address.city}
        onChange={(e) => set('city', e.target.value)}
        className={cls}
        placeholder="City"
      />
      <Select
        value={address.province}
        onValueChange={(v) => set('province', v)}
      >
        <SelectTrigger className="h-auto min-h-0 text-[11px] px-1.5 py-[3px] rounded-[5px]">
          <SelectValue placeholder="Province" />
        </SelectTrigger>
        <SelectContent>
          {CA_PROVINCES.map((p) => (
            <SelectItem key={p.code} value={p.code} className="text-xs">
              {p.code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={address.postalCode}
        onChange={(e) => set('postalCode', e.target.value)}
        className={cls}
        placeholder="Postal code"
      />
    </div>
  );
}

// ─── Without PO ──────────────────────────────────────────────────────────────

function WithoutPoMeta({
  entry,
  activeKey,
  defaultExpectedYmd,
  minExpectedYmd,
  onCreatePo,
  onArchive,
  onUnarchive,
  onDeleteReplacementOrder,
  draftPoNumber,
  poNumberIsManual,
  onPoNumberChange,
  onPoNumberReset,
  customerDefaultShipping,
  customerDefaultBilling,
  customerBillingSameAsShipping,
  inboxShopifyOrderIds,
}: {
  entry: SupplierEntry;
  activeKey: SupplierKey;
  defaultExpectedYmd: string;
  minExpectedYmd: string | null;
  onCreatePo: (
    key: SupplierKey,
    payload?: CreatePoPayload,
  ) => Promise<EditPoResult>;
  onArchive?: (key: SupplierKey) => void;
  onUnarchive?: (key: SupplierKey) => void;
  onDeleteReplacementOrder?: () => void | Promise<void>;
  draftPoNumber?: string;
  poNumberIsManual?: boolean;
  onPoNumberChange?: (value: string) => void;
  onPoNumberReset?: () => void;
  customerDefaultShipping?: PoAddress | null;
  customerDefaultBilling?: PoAddress | null;
  customerBillingSameAsShipping?: boolean;
  inboxShopifyOrderIds?: string[];
}) {
  const [createPoNumberError, setCreatePoNumberError] =
    useState<MetaPoNumberFieldError>(null);
  const [creating, setCreating] = useState(false);
  const [shipAddrEditOpen, setShipAddrEditOpen] = useState(false);
  const [shipAddr, setShipAddr] = useState<PoAddress>(
    customerDefaultShipping ?? { ...EMPTY_ADDR },
  );
  const [shipPresetId, setShipPresetId] = useState<string | null>(null);
  const [billPresetId, setBillPresetId] = useState<string | null>(null);
  const [billAddr, setBillAddr] = useState<PoAddress>(
    customerDefaultBilling ?? { ...EMPTY_ADDR },
  );
  const [billSame, setBillSame] = useState(
    customerBillingSameAsShipping ?? true,
  );
  useEffect(() => {
    setCreatePoNumberError(null);
    setShipAddrEditOpen(false);
    setShipAddr(customerDefaultShipping ?? { ...EMPTY_ADDR });
    setShipPresetId(null);
    setBillPresetId(null);
    setBillAddr(customerDefaultBilling ?? { ...EMPTY_ADDR });
    setBillSame(customerBillingSameAsShipping ?? true);
  }, [
    activeKey,
    customerDefaultShipping,
    customerDefaultBilling,
    customerBillingSameAsShipping,
  ]);

  const buildCreatePayload = (): CreatePoPayload => {
    const form = document.getElementById(
      `meta-form-${activeKey}`,
    ) as HTMLFormElement | null;
    const fd = form ? new FormData(form) : null;
    return {
      expectedDate: (fd?.get('expectedDate') as string) || null,
      comment: (fd?.get('comment') as string) || null,
      shippingAddress: isAddrEmpty(shipAddr) ? null : shipAddr,
      billingAddress: billSame ? null : isAddrEmpty(billAddr) ? null : billAddr,
      billingSameAsShipping: billSame,
      deliveryLocationPresetId: shipPresetId,
    };
  };

  const handleCreate = async (hubPending?: boolean) => {
    if (poNumberIsManual && !(draftPoNumber ?? '').trim()) {
      setCreatePoNumberError('required');
      return;
    }
    setCreating(true);
    setCreatePoNumberError(null);
    try {
      const result = await onCreatePo(activeKey, {
        ...buildCreatePayload(),
        hubPending: hubPending === true,
      });
      if (result.ok) {
        // success toast is shown in OrderManagementView (needs access to navigation state)
      } else if (result.reason === 'duplicate_po_number') {
        setCreatePoNumberError('duplicate');
      } else {
        toast.error('Failed to create PO — please try again');
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <form
      key={activeKey}
      id={`meta-form-${activeKey}`}
      onSubmit={(e) => e.preventDefault()}
    >
      <Section>
        <MetaLabel>Status</MetaLabel>
        <Badge variant="gray" className="rounded px-1.5 text-[10px]">
          Without PO
        </Badge>
      </Section>

      <Section>
        <MetaLabel>PO no.</MetaLabel>
        <MetaPoNumberInput
          value={draftPoNumber ?? ''}
          onChange={(v) => {
            setCreatePoNumberError(null);
            onPoNumberChange?.(v);
          }}
          error={createPoNumberError}
          muted={!poNumberIsManual && !createPoNumberError}
        />
        {poNumberIsManual && (
          <button
            type="button"
            className="text-[9px] text-muted-foreground hover:text-foreground mt-0.5"
            onClick={() => {
              setCreatePoNumberError(null);
              onPoNumberReset?.();
            }}
          >
            Reset to auto
          </button>
        )}
      </Section>

      <Section>
        <MetaLabel>Supplier</MetaLabel>
        <MetaValue>{entry.supplierCompany}</MetaValue>
        <MetaSub
          red={
            entry.supplierOrderChannelType === 'email' &&
            entry.supplierEmailMissing
          }
        >
          {entry.supplierOrderChannelSummary}
        </MetaSub>
      </Section>

      <Section>
        <div className="flex flex-col gap-2.5">
          <FieldInput label="Expected date">
            <YmdDateInput
              name="expectedDate"
              defaultValue={defaultExpectedYmd}
              min={minExpectedYmd ?? undefined}
              className="h-auto min-h-0 text-[11px] px-1.5 py-[4px] rounded-[5px] md:text-[11px]"
            />
          </FieldInput>
          <FieldInput label="PO note">
            <Textarea
              name="comment"
              placeholder="Optional — shown on printed PO"
              className="min-h-11 h-11 resize-none text-[11px] px-1.5 py-[4px] rounded-[5px] md:text-[11px]"
            />
          </FieldInput>
        </div>
      </Section>

      <Section>
        <DeliveryLocationPresetPicker
          compact
          className="mb-1.5"
          selectedPresetId={shipPresetId}
          onApply={({ presetId, poAddress }) => {
            setShipPresetId(presetId);
            setShipAddr(poAddress);
          }}
          onClear={() => setShipPresetId(null)}
        />
        {shipAddrEditOpen ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-1">
              <MetaLabel>Ship to</MetaLabel>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground rounded p-0.5 shrink-0"
                aria-label="Close ship-to editor"
                onClick={() => setShipAddrEditOpen(false)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <CompactAddressInput
              label=""
              address={shipAddr}
              onChange={(a) => {
                setShipPresetId(null);
                setShipAddr(a);
              }}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-1 mb-0.5">
              <MetaLabel>Ship to</MetaLabel>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground rounded p-0.5 shrink-0"
                aria-label="Edit ship-to address"
                onClick={() => setShipAddrEditOpen(true)}
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
            <MetaValue>{formatAddrOneLine(shipAddr)}</MetaValue>
          </>
        )}
      </Section>

      <Section>
        <div className="flex items-center gap-1.5 mb-1">
          <input
            type="checkbox"
            id={`bill-same-${activeKey}`}
            checked={billSame}
            onChange={(e) => {
              const next = e.target.checked;
              setBillSame(next);
              if (next) setBillPresetId(null);
            }}
            className="h-3 w-3 rounded border-gray-300"
          />
          <label
            htmlFor={`bill-same-${activeKey}`}
            className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium"
          >
            Billing same as shipping
          </label>
        </div>
        {!billSame && (
          <>
            <DeliveryLocationPresetPicker
              compact
              className="mb-1.5"
              selectedPresetId={billPresetId}
              onApply={({ presetId, poAddress }) => {
                setBillPresetId(presetId);
                setBillAddr(poAddress);
              }}
              onClear={() => setBillPresetId(null)}
            />
            <CompactAddressInput
              label="Bill to"
              address={billAddr}
              onChange={(a) => {
                setBillPresetId(null);
                setBillAddr(a);
              }}
            />
          </>
        )}
      </Section>

      <div className="px-3 py-2.5 flex flex-col gap-1.5">
        <Button
          type="button"
          size="xs"
          className="w-full justify-center text-[11px] rounded-[5px]"
          disabled={creating}
          onClick={() => void handleCreate()}
        >
          {creating ? (
            <Spinner className="h-4 w-4 mr-1 text-white" />
          ) : (
            'Create PO now'
          )}
        </Button>
        {inboxShopifyOrderIds && inboxShopifyOrderIds.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="w-full justify-center text-[11px] rounded-[5px]"
            disabled={creating}
            onClick={() => void handleCreate(true)}
          >
            {creating ? (
              <Spinner className="h-4 w-4 mr-1" />
            ) : (
              'Mark as PO pending'
            )}
          </Button>
        )}
        {(entry.isArchived ? onUnarchive : onArchive) ? (
          <>
            <Separator className="my-0.5" />
            {entry.isArchived ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="w-full justify-center text-[11px] rounded-[5px]"
                onClick={() => onUnarchive?.(activeKey)}
              >
                Unarchive
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="w-full justify-center text-[11px] rounded-[5px] text-muted-foreground"
                onClick={() => onArchive?.(activeKey)}
              >
                Archive
              </Button>
            )}
          </>
        ) : null}
        {onDeleteReplacementOrder && (
          <>
            <Separator className="my-0.5" />
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="w-full justify-center text-[11px] rounded-[5px] text-destructive hover:text-destructive"
              onClick={() => {
                const ok = window.confirm('Delete this replacement order? This cannot be undone.');
                if (ok) void onDeleteReplacementOrder();
              }}
            >
              Delete Replacement Order
            </Button>
          </>
        )}
      </div>
    </form>
  );
}

// ─── With PO ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (d == null || d === '') return '—';
  return d;
}

function WithPoMeta({
  entry,
  poPanelMeta,
  selectedPoBlockId,
  onEditPo,
  onDeletePo,
  onPoEmailSent,
  onPoEmailDeliveryWaivedChange,
  activeKey,
  onArchivePurchaseOrder,
  onUnarchive,
  poPrintBlock,
  poPrintHeadline,
  customerDefaultBilling,
  customerDefaultShipping,
  lineItemsLoading,
}: {
  entry: SupplierEntry;
  poPanelMeta?: PoPanelMeta;
  selectedPoBlockId?: string | null;
  onEditPo: (poId: string, fields: EditPoFields) => Promise<EditPoResult>;
  onDeletePo: (poId: string) => void;
  onPoEmailSent?: (poId: string) => void;
  onPoEmailDeliveryWaivedChange?: (
    poId: string,
    waived: boolean,
  ) => void | Promise<void>;
  activeKey: SupplierKey;
  onArchivePurchaseOrder?: (poId: string) => void;
  onUnarchive?: (key: SupplierKey) => void;
  poPrintBlock?: OfficePurchaseOrderBlock | null;
  poPrintHeadline?: string | null;
  customerDefaultBilling?: PoAddress | null;
  customerDefaultShipping?: PoAddress | null;
  lineItemsLoading?: boolean;
}) {
  const router = useRouter();
  const [sendingEmail, setSendingEmail] = useState(false);
  const [waivingEmail, setWaivingEmail] = useState(false);
  const [emailSentLocal, setEmailSentLocal] = useState(false);
  const [emailSendError, setEmailSendError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editExpected, setEditExpected] = useState('');
  const [editComment, setEditComment] = useState('');
  const [editPoNumber, setEditPoNumber] = useState('');
  const [poNumberError, setPoNumberError] = useState<
    'duplicate' | 'required' | null
  >(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingStatusSaving, setPendingStatusSaving] = useState(false);

  useEffect(() => {
    setEmailSentLocal(!!poPanelMeta?.emailSentAt);
    setEmailSendError(null);
  }, [
    selectedPoBlockId,
    poPanelMeta?.emailSentAt,
    poPanelMeta?.emailDeliveryWaivedAt,
  ]);

  const performSendEmail = async () => {
    if (!selectedPoBlockId || selectedPoBlockId === '__drafts__') return;
    setSendingEmail(true);
    setEmailSendError(null);
    try {
      const result = await postSendPurchaseOrderEmail(selectedPoBlockId);
      if (!result.ok) {
        setEmailSendError(result.error);
        return;
      }
      onPoEmailSent?.(selectedPoBlockId);
      setEmailSentLocal(true);
      router.refresh();
    } catch {
      const msg = 'Network error — could not send email';
      setEmailSendError(msg);
      toast.error(msg);
    } finally {
      setSendingEmail(false);
    }
  };

  const handleDoNotSendEmail = async () => {
    if (!selectedPoBlockId || selectedPoBlockId === '__drafts__') return;
    if (!onPoEmailDeliveryWaivedChange) return;
    setWaivingEmail(true);
    try {
      await onPoEmailDeliveryWaivedChange(selectedPoBlockId, true);
    } finally {
      setWaivingEmail(false);
    }
  };

  const handleUndoEmailWaive = async () => {
    if (!selectedPoBlockId || selectedPoBlockId === '__drafts__') return;
    if (!onPoEmailDeliveryWaivedChange) return;
    setWaivingEmail(true);
    try {
      await onPoEmailDeliveryWaivedChange(selectedPoBlockId, false);
    } finally {
      setWaivingEmail(false);
    }
  };

  const handleSendEmailClick = () => {
    if (!selectedPoBlockId || selectedPoBlockId === '__drafts__') return;
    const isResend = emailSentLocal || !!poPanelMeta?.emailSentAt;
    if (isResend) {
      toast('Resend PO email to all contacts?', {
        description:
          'The same PO PDF will be emailed again to every address on file for this supplier.',
        action: {
          label: 'Resend',
          onClick: () => {
            void performSendEmail();
          },
        },
        cancel: {
          label: 'Cancel',
          onClick: () => {},
        },
      });
      return;
    }
    void performSendEmail();
  };

  const poNumber = poPanelMeta?.poNumber ?? entry.referenceKey;
  const created = fmtDate(poPanelMeta?.dateCreated ?? entry.dateCreated);
  const createdByLabel = (() => {
    const u = poPanelMeta?.createdBy;
    if (!u) return '—';
    const name = u.name?.trim() ?? '';
    const email = u.email?.trim() ?? '';
    if (name && email) return `${name} (${email})`;
    return name || email || '—';
  })();
  const expected = fmtDate(poPanelMeta?.expectedDate ?? entry.expectedDate);
  const internalNote = poPanelMeta?.comment?.trim() ?? '';
  const statusLabel = poPanelMeta?.status ?? 'unfulfilled';
  const f = poPanelMeta?.fulfillDoneCount ?? entry.fulfillDoneCount;
  const p = poPanelMeta?.fulfillPendingCount ?? entry.fulfillPendingCount;
  const t = poPanelMeta?.fulfillTotalCount ?? entry.fulfillTotalCount;
  const linkedOrders = poPanelMeta?.linkedShopifyOrders ?? [];
  const lastSyncedAt = poPanelMeta?.lastSyncedAt ?? null;
  const poShipAddr = poPanelMeta?.shippingAddress ?? null;
  const poBillAddr = poPanelMeta?.billingAddress ?? null;
  const poBillSame = poPanelMeta?.billingSameAsShipping ?? true;

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch('/api/order/sync/shopify', { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setSyncError(
          [json.error, json.detail].filter(Boolean).join(': ') ||
            `HTTP ${res.status}`,
        );
        return;
      }
      if (json.ok) router.refresh();
      else
        setSyncError(
          [json.error, json.detail].filter(Boolean).join(': ') || 'Sync failed',
        );
    } catch (err) {
      console.error('Manual sync failed:', err);
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  const [editShipAddr, setEditShipAddr] = useState<PoAddress>({
    ...EMPTY_ADDR,
  });
  const [editShipPresetId, setEditShipPresetId] = useState<string | null>(null);
  const [editBillPresetId, setEditBillPresetId] = useState<string | null>(null);
  const [editBillAddr, setEditBillAddr] = useState<PoAddress>({
    ...EMPTY_ADDR,
  });
  const [editBillSame, setEditBillSame] = useState(true);

  const handleStartEdit = () => {
    const minY = poPanelMeta?.minExpectedDateYmd ?? null;
    const raw = poPanelMeta?.expectedDate ?? '';
    const expY = raw.length >= 10 ? raw.slice(0, 10) : '';
    setEditExpected(minY && (!expY || expY < minY) ? minY : expY);
    setEditComment(poPanelMeta?.comment ?? '');
    setEditPoNumber(poPanelMeta?.poNumber ?? entry.referenceKey ?? '');
    setPoNumberError(null);
    setSaveFailed(false);
    setEditShipAddr(poShipAddr ?? { ...EMPTY_ADDR });
    setEditShipPresetId(poPanelMeta?.deliveryLocationPreset?.id ?? null);
    setEditBillPresetId(null);
    setEditBillAddr(poBillAddr ?? { ...EMPTY_ADDR });
    setEditBillSame(poBillSame);
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedPoBlockId) return;
    const trimmed = editPoNumber.trim();
    if (!trimmed) {
      setPoNumberError('required');
      setSaveFailed(false);
      return;
    }
    setSaving(true);
    setPoNumberError(null);
    setSaveFailed(false);
    try {
      const result = await onEditPo(selectedPoBlockId, {
        expectedDate: editExpected || null,
        comment: editComment || null,
        poNumber: trimmed,
        shippingAddress: isAddrEmpty(editShipAddr) ? null : editShipAddr,
        billingAddress: editBillSame
          ? null
          : isAddrEmpty(editBillAddr)
            ? null
            : editBillAddr,
        billingSameAsShipping: editBillSame,
        deliveryLocationPresetId: editShipPresetId,
      });
      if (result.ok) {
        setEditing(false);
        return;
      }
      if (result.reason === 'duplicate_po_number') {
        setPoNumberError('duplicate');
      } else {
        setSaveFailed(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setPoNumberError(null);
    setSaveFailed(false);
  };

  const handleDelete = () => {
    if (!selectedPoBlockId) return;
    const confirmed = window.confirm(
      `Delete PO #${poNumber}? This cannot be undone.`,
    );
    if (confirmed) {
      onDeletePo(selectedPoBlockId);
    }
  };

  const canPrintPo =
    poPrintBlock != null &&
    poPrintBlock.id !== 'new' &&
    poPrintBlock.panelMeta != null &&
    poPrintBlock.lineItems.length > 0;

  const buildCurrentPoPdfInput = () => {
    if (!poPrintBlock) return null;
    return buildPoPdfInput({
      block: poPrintBlock,
      supplierCompany: entry.supplierCompany,
      customerHeadline: poPrintHeadline ?? null,
      fallbackBillingAddress: customerDefaultBilling ?? null,
      fallbackShippingAddress: customerDefaultShipping ?? null,
    });
  };

  const handleDownloadPo = () => {
    const input = buildCurrentPoPdfInput();
    if (input) downloadPoPdf(input);
  };

  const handlePrintPo = () => {
    const input = buildCurrentPoPdfInput();
    if (input) openPoPdfPrint(input);
  };

  return (
    <>
      <Section>
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <MetaLabel>PO no.</MetaLabel>
          {!editing && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground rounded p-0.5 shrink-0"
              aria-label="Edit PO number and other fields"
              onClick={handleStartEdit}
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
        {editing ? (
          <MetaPoNumberInput
            value={editPoNumber}
            onChange={(v) => {
              setEditPoNumber(v);
              if (poNumberError) setPoNumberError(null);
              if (saveFailed) setSaveFailed(false);
            }}
            error={poNumberError}
          />
        ) : (
          <MetaValue mono>{poNumber}</MetaValue>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Badge
            variant="blue"
            className="rounded px-1.5 text-[10px] capitalize"
          >
            {statusLabel.replace(/_/g, ' ')}
          </Badge>
          {poPanelMeta?.currency && (
            <Badge variant="gray" className="rounded px-1.5 text-[10px]">
              {poPanelMeta.currency}
            </Badge>
          )}
        </div>
      </Section>

      <Section>
        <MetaLabel>PO created</MetaLabel>
        <MetaValue>{created}</MetaValue>
      </Section>

      <Section>
        <MetaLabel>Created by</MetaLabel>
        <MetaValue>{createdByLabel}</MetaValue>
      </Section>

      <Section>
        <MetaLabel>Expected delivery</MetaLabel>
        {editing ? (
          <YmdDateInput
            value={editExpected}
            onChange={(e) => setEditExpected(e.target.value)}
            min={poPanelMeta?.minExpectedDateYmd ?? undefined}
            className="h-auto min-h-0 text-[11px] px-1.5 py-[4px] rounded-[5px] md:text-[11px]"
          />
        ) : (
          <MetaValue>{expected}</MetaValue>
        )}
      </Section>

      <Section>
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <MetaLabel>PO note</MetaLabel>
          {!editing && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground rounded p-0.5 shrink-0"
              aria-label="Edit PO note"
              onClick={handleStartEdit}
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
        {editing ? (
          <Textarea
            value={editComment}
            onChange={(e) => setEditComment(e.target.value)}
            placeholder="Optional — shown on printed PO"
            className="min-h-11 h-11 resize-none text-[11px] px-1.5 py-[4px] rounded-[5px] md:text-[11px]"
          />
        ) : (
          <p className="text-[11px] leading-snug text-foreground whitespace-pre-wrap break-words">
            {internalNote || '—'}
          </p>
        )}
      </Section>

      <Section>
        <MetaLabel>Supplier</MetaLabel>
        <MetaValue>{entry.supplierCompany}</MetaValue>
        <MetaSub
          red={
            entry.supplierOrderChannelType === 'email' &&
            entry.supplierEmailMissing
          }
        >
          {entry.supplierOrderChannelSummary}
        </MetaSub>
      </Section>

      <Section>
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <MetaLabel>Ship to</MetaLabel>
          {!editing && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground rounded p-0.5 shrink-0"
              aria-label="Edit PO (shipping and other fields)"
              onClick={handleStartEdit}
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
        {editing ? (
          <>
            <DeliveryLocationPresetPicker
              compact
              className="mb-1.5"
              selectedPresetId={editShipPresetId}
              onApply={({ presetId, poAddress }) => {
                setEditShipPresetId(presetId);
                setEditShipAddr(poAddress);
              }}
              onClear={() => setEditShipPresetId(null)}
            />
            <CompactAddressInput
              label=""
              address={editShipAddr}
              onChange={(a) => {
                setEditShipPresetId(null);
                setEditShipAddr(a);
              }}
            />
          </>
        ) : (
          <>
            <MetaValue>{formatAddrOneLine(poShipAddr)}</MetaValue>
            {poPanelMeta?.deliveryLocationPreset ? (
              <div className="mt-0.5">
                <MetaSub>
                  프리셋: {poPanelMeta.deliveryLocationPreset.name}
                  {poPanelMeta.deliveryLocationPreset.locationCodes.length > 0
                    ? ` (${poPanelMeta.deliveryLocationPreset.locationCodes.join(', ')})`
                    : ' (Location 미연결)'}
                </MetaSub>
              </div>
            ) : null}
          </>
        )}
      </Section>

      <Section>
        {editing ? (
          <>
            <div className="flex items-center gap-1.5 mb-1">
              <input
                type="checkbox"
                id="edit-bill-same"
                checked={editBillSame}
                onChange={(e) => {
                  const next = e.target.checked;
                  setEditBillSame(next);
                  if (next) setEditBillPresetId(null);
                }}
                className="h-3 w-3 rounded border-gray-300"
              />
              <label
                htmlFor="edit-bill-same"
                className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium"
              >
                Billing same as shipping
              </label>
            </div>
            {!editBillSame && (
              <>
                <DeliveryLocationPresetPicker
                  compact
                  className="mb-1.5"
                  selectedPresetId={editBillPresetId}
                  onApply={({ presetId, poAddress }) => {
                    setEditBillPresetId(presetId);
                    setEditBillAddr(poAddress);
                  }}
                  onClear={() => setEditBillPresetId(null)}
                />
                <CompactAddressInput
                  label=""
                  address={editBillAddr}
                  onChange={(a) => {
                    setEditBillPresetId(null);
                    setEditBillAddr(a);
                  }}
                />
              </>
            )}
          </>
        ) : (
          <>
            <MetaLabel>Bill to</MetaLabel>
            <MetaValue>
              {poBillSame ? 'Same as shipping' : formatAddrOneLine(poBillAddr)}
            </MetaValue>
          </>
        )}
      </Section>

      <Section>
        <MetaLabel>Fulfill summary</MetaLabel>
        <div className="flex gap-2 mt-1">
          <StatCol value={f} label="done" color="text-[#27500A]" />
          <StatCol value={p} label="pending" color="text-[#BA7517]" />
          <StatCol value={t} label="total" color="text-muted-foreground" />
        </div>
      </Section>

      <div className="px-3 py-2.5 flex flex-col gap-1.5">
        {editing ? (
          <>
            {saveFailed && (
              <MetaSub red>Could not save changes. Please try again.</MetaSub>
            )}
            <Button
              size="xs"
              className="w-full justify-center text-[11px] rounded-[5px]"
              disabled={saving}
              onClick={() => void handleSaveEdit()}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            <Button
              variant="outline"
              size="xs"
              className="w-full justify-center text-[11px] rounded-[5px]"
              disabled={saving}
              onClick={handleCancelEdit}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            {entry.supplierOrderChannelType === 'email' ? (
              <>
                {emailSentLocal || poPanelMeta?.emailSentAt ? (
                  <Button
                    size="xs"
                    className="w-full justify-center text-[11px] rounded-[5px] bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-800 dark:hover:bg-emerald-950/60"
                    variant="outline"
                    onClick={() => handleSendEmailClick()}
                    disabled={sendingEmail || lineItemsLoading}
                  >
                    {sendingEmail ? 'Sending…' : 'Email sent - resend?'}
                  </Button>
                ) : poPanelMeta?.emailDeliveryWaivedAt ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[10px] text-muted-foreground text-center leading-snug px-0.5">
                      Not sending email from the hub for this PO (reminders
                      off).
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="w-full justify-center text-[11px] rounded-[5px]"
                      disabled={waivingEmail || lineItemsLoading}
                      onClick={() => void handleUndoEmailWaive()}
                    >
                      {waivingEmail ? 'Updating…' : 'Undo — show reminders'}
                    </Button>
                  </div>
                ) : entry.hasEmail ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button
                        variant="outline"
                        size="xs"
                        className="w-full justify-center text-[11px] rounded-[5px] border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white dark:border-emerald-500"
                        onClick={() => handleSendEmailClick()}
                        disabled={sendingEmail || lineItemsLoading}
                      >
                        {sendingEmail ? 'Sending…' : 'Send email'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        className="w-full justify-center text-[11px] rounded-[5px]"
                        disabled={
                          waivingEmail ||
                          lineItemsLoading ||
                          !onPoEmailDeliveryWaivedChange
                        }
                        onClick={() => void handleDoNotSendEmail()}
                      >
                        {waivingEmail ? '…' : 'Do not send'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <Button
                      variant="outline"
                      size="xs"
                      disabled
                      className="w-full justify-center text-[11px] rounded-[5px]"
                    >
                      No email on file
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="w-full justify-center text-[11px] rounded-[5px] text-muted-foreground"
                      disabled={
                        waivingEmail ||
                        lineItemsLoading ||
                        !onPoEmailDeliveryWaivedChange
                      }
                      onClick={() => void handleDoNotSendEmail()}
                    >
                      {waivingEmail ? '…' : 'Do not send'}
                    </Button>
                  </div>
                )}
                {emailSendError && (
                  <p
                    className="text-[9px] text-destructive leading-snug break-words"
                    role="alert"
                  >
                    {emailSendError}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground text-center leading-snug px-1">
                PO uses{' '}
                {entry.supplierOrderChannelType === 'order_link'
                  ? 'supplier order link'
                  : 'direct instructions'}
                . Open the comm panel for details.
              </p>
            )}
            <Separator className="my-0.5" />
            <div className="flex gap-1">
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="min-w-0 flex-1 justify-center text-[11px] rounded-[5px]"
                disabled={!canPrintPo || lineItemsLoading}
                onClick={handleDownloadPo}
              >
                Download PO
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="min-w-0 flex-1 justify-center text-[11px] rounded-[5px]"
                disabled={!canPrintPo || lineItemsLoading}
                onClick={handlePrintPo}
              >
                Print PO
              </Button>
            </div>
            <Button
              variant="outline"
              size="xs"
              className="w-full justify-center text-[11px] rounded-[5px]"
              onClick={handleStartEdit}
            >
              Edit PO
            </Button>
            <Button
              variant="outline"
              size="xs"
              className="w-full justify-center text-[11px] rounded-[5px] text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              Delete PO
            </Button>
            {entry.isArchived
              ? onUnarchive && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="w-full justify-center text-[11px] rounded-[5px] text-muted-foreground"
                    onClick={() => onUnarchive(activeKey)}
                  >
                    Unarchive PO
                  </Button>
                )
              : onArchivePurchaseOrder &&
                selectedPoBlockId &&
                selectedPoBlockId !== '__drafts__' &&
                selectedPoBlockId !== 'new' && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="w-full justify-center text-[11px] rounded-[5px] text-muted-foreground"
                    onClick={() => onArchivePurchaseOrder(selectedPoBlockId)}
                  >
                    Archive PO
                  </Button>
                )}
          </>
        )}
      </div>

      {/* Linked Shopify Orders */}
      {linkedOrders.length > 0 && (
        <Section>
          <MetaLabel>Linked orders</MetaLabel>
          <div className="flex flex-col gap-1.5 mt-1">
            {linkedOrders.map((o) => (
              <LinkedOrderRow key={o.id} order={o} />
            ))}
          </div>
        </Section>
      )}

      {selectedPoBlockId &&
        selectedPoBlockId !== '__drafts__' &&
        selectedPoBlockId !== 'new' && (
          <Section>
            <Button
              type="button"
              variant={statusLabel === 'pending' ? 'default' : 'outline'}
              size="xs"
              className="w-full justify-center text-[11px] rounded-[5px]"
              disabled={pendingStatusSaving}
              onClick={() => {
                if (!selectedPoBlockId) return;
                const next: PurchaseOrderStatus =
                  statusLabel === 'pending' ? 'unfulfilled' : 'pending';
                setPendingStatusSaving(true);
                void (async () => {
                  try {
                    await onEditPo(selectedPoBlockId, {
                      status: next,
                    });
                  } finally {
                    setPendingStatusSaving(false);
                  }
                })();
              }}
            >
              {pendingStatusSaving
                ? 'Saving…'
                : statusLabel === 'pending'
                  ? 'Clear pending'
                  : 'Mark PO pending'}
            </Button>
          </Section>
        )}

      {/* Shopify sync */}
      <div className="mt-auto px-3 py-2.5 border-t">
        <div className="flex items-center justify-between">
          <MetaLabel>Shopify sync</MetaLabel>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Sync now"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={syncing ? 'animate-spin' : ''}
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {lastSyncedAt ? (
            <>
              Last synced{' '}
              {formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true })}
            </>
          ) : (
            'Not synced yet'
          )}
        </div>
        {syncError && (
          <p
            className="text-[9px] text-destructive mt-1 leading-snug break-words"
            role="alert"
          >
            {syncError}
          </p>
        )}
      </div>
    </>
  );
}

// ─── Linked Order Row ─────────────────────────────────────────────────────────

function LinkedOrderRow({ order }: { order: LinkedShopifyOrder }) {
  const statusLabel = order.fulfillmentStatus
    ? formatShopifyOrderDisplayFulfillmentStatus(order.fulfillmentStatus)
    : '—';
  const isFulfilled = order.fulfillmentStatus === 'FULFILLED';
  const note = order.customerNote?.trim();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-1">
        <Badge
          variant={isFulfilled ? 'green' : 'gray'}
          className="rounded px-1 text-[9px] flex-shrink-0 mt-px"
        >
          {order.name}
        </Badge>
        <div className="min-w-0 text-[10px] text-muted-foreground truncate">
          {order.customerName && (
            <span className="text-foreground">{order.customerName}</span>
          )}
          {order.customerName && ' · '}
          {statusLabel}
        </div>
      </div>
      {note && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 dark:border-amber-900 dark:bg-amber-950/40">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-amber-950 dark:text-amber-100">
            Customer note
          </div>
          <p className="text-[11px] leading-snug text-amber-950 dark:text-amber-50 mt-0.5 whitespace-pre-wrap break-words">
            {note}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Stat column ─────────────────────────────────────────────────────────────

function StatCol({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div className="text-center">
      <div className={cn('text-base font-medium', color)}>{value}</div>
      <div className="text-[9px] text-muted-foreground">{label}</div>
    </div>
  );
}
