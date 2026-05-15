'use client';

import { useMemo, useOptimistic, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';
import {
  GroupBulkDeliveryScheduleDialog,
  pickBulkDeliveryScheduleSeed,
} from './GroupBulkDeliveryScheduleDialog';
import { SupplierForm, type SupplierRow, type SupplierGroup } from './SupplierForm';

type Props = {
  vendors: string[];
  suppliers: SupplierRow[];
  groups: SupplierGroup[];
  shopifyConfigured: boolean;
};

function sortSuppliers(list: SupplierRow[]): SupplierRow[] {
  return [...list].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    return a.company.localeCompare(b.company);
  });
}

export function SuppliersClient({
  vendors,
  suppliers: initial,
  groups,
  shopifyConfigured,
}: Props) {
  const defaultGroupId =
    groups.find((g) => g.slug === 'unknown-supplier')?.id ??
    groups.find((g) => g.slug === 'external')?.id ??
    null;
  const router = useRouter();
  const [prefillVendor, setPrefillVendor] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [, startTransition] = useTransition();

  const [newGroupName, setNewGroupName] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [bulkDeliveryGroupId, setBulkDeliveryGroupId] = useState<string | null>(
    null,
  );
  const [groupError, setGroupError] = useState<string | null>(null);
  const editGroupRef = useRef<HTMLInputElement>(null);

  const [optimisticSuppliers, toggleOptimistic] = useOptimistic(
    initial,
    (state, toggledId: string) =>
      sortSuppliers(
        state.map((s) =>
          s.id === toggledId ? { ...s, isFavorite: !s.isFavorite } : s,
        ),
      ),
  );

  const bulkDeliveryGroup = useMemo(
    () =>
      bulkDeliveryGroupId
        ? (groups.find((g) => g.id === bulkDeliveryGroupId) ?? null)
        : null,
    [bulkDeliveryGroupId, groups],
  );
  const bulkGroupSupplierCount = useMemo(
    () =>
      bulkDeliveryGroup
        ? optimisticSuppliers.filter((s) => s.groupId === bulkDeliveryGroup.id)
            .length
        : 0,
    [bulkDeliveryGroup, optimisticSuppliers],
  );
  const bulkScheduleSeed = useMemo(
    () =>
      bulkDeliveryGroup
        ? pickBulkDeliveryScheduleSeed(
            optimisticSuppliers,
            bulkDeliveryGroup.id,
            bulkDeliveryGroup.slug,
          )
        : null,
    [bulkDeliveryGroup, optimisticSuppliers],
  );

  const registeredVendors = new Set(
    initial
      .map((s) => s.shopifyVendorName)
      .filter((v): v is string => v !== null),
  );

  function handleCreateFromVendor(vendor: string) {
    setPrefillVendor(vendor);
    setEditing(null);
    setShowForm(true);
  }

  function handleCreateNew() {
    setPrefillVendor(null);
    setEditing(null);
    setShowForm(true);
  }

  function handleEdit(s: SupplierRow) {
    setEditing(s);
    setPrefillVendor(null);
  }

  function handleDone() {
    setShowForm(false);
    setEditing(null);
    setPrefillVendor(null);
    router.refresh();
  }

  function toggleFavorite(id: string) {
    toggleOptimistic(id);
    startTransition(async () => {
      await fetch(`/api/order/suppliers/${id}`, { method: 'PATCH' });
      router.refresh();
    });
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    setGroupError(null);
    const res = await fetch('/api/order/supplier-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newGroupName.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setGroupError(data?.error ?? 'Failed');
      return;
    }
    setNewGroupName('');
    setAddingGroup(false);
    router.refresh();
  }

  async function handleUpdateGroup(id: string) {
    if (!editGroupName.trim()) return;
    setGroupError(null);
    const res = await fetch(`/api/order/supplier-groups/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editGroupName.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setGroupError(data?.error ?? 'Failed');
      return;
    }
    setEditingGroupId(null);
    router.refresh();
  }

  async function handleDeleteGroup(id: string) {
    setGroupError(null);
    const res = await fetch(`/api/order/supplier-groups/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setGroupError(data?.error ?? 'Failed');
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex gap-6 items-start">
        {/* Left: Shopify Vendors */}
        <div className="w-[280px] flex-shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Shopify Vendors</h2>
            <span className="text-xs text-muted-foreground">
              {vendors.length}
            </span>
          </div>

          {!shopifyConfigured ? (
            <p className="text-xs text-muted-foreground">
              Shopify not configured. Add{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                SHOPIFY_SHOP_DOMAIN
              </code>{' '}
              and{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                SHOPIFY_ADMIN_TOKEN
              </code>{' '}
              to your environment.
            </p>
          ) : vendors.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No vendors found in Shopify.
            </p>
          ) : (
            (() => {
              const unregistered = vendors.filter(
                (v) => !registeredVendors.has(v),
              );
              const registered = vendors.filter((v) =>
                registeredVendors.has(v),
              );
              return (
                <div className="space-y-2">
                  {unregistered.length > 0 && (
                    <Collapsible>
                      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors cursor-pointer">
                        <span>Unregistered ({unregistered.length})</span>
                        <span className="text-[10px]">▾</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="rounded-md border border-t-0 rounded-t-none divide-y max-h-[400px] overflow-y-auto">
                          {unregistered.map((v) => (
                            <div
                              key={v}
                              className="flex items-center justify-between px-3 py-2 text-sm"
                            >
                              <span>{v}</span>
                              <Button
                                variant="outline"
                                size="xs"
                                className="text-[10px] rounded-[5px]"
                                onClick={() => handleCreateFromVendor(v)}
                              >
                                Create
                              </Button>
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {registered.length > 0 && (
                    <Collapsible>
                      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors cursor-pointer">
                        <span>Registered ({registered.length})</span>
                        <span className="text-[10px]">▾</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="rounded-md border border-t-0 rounded-t-none divide-y max-h-[300px] overflow-y-auto">
                          {registered.map((v) => (
                            <div
                              key={v}
                              className="flex items-center justify-between px-3 py-2 text-sm"
                            >
                              <span className="text-muted-foreground">{v}</span>
                              <Badge
                                variant="green"
                                className="rounded px-1.5 text-[10px]"
                              >
                                Registered
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              );
            })()
          )}
          {/* Groups */}
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Groups</h2>
              <Button
                variant="ghost"
                size="xs"
                className="text-[10px]"
                onClick={() => {
                  setAddingGroup(true);
                  setGroupError(null);
                }}
              >
                + Add
              </Button>
            </div>

            {groupError && (
              <p className="text-[11px] text-destructive rounded bg-destructive/10 px-2 py-1">
                {groupError}
              </p>
            )}

            {addingGroup && (
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCreateGroup();
                }}
              >
                <Input
                  autoFocus
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Group name"
                  className="h-7 text-xs px-2"
                />
                <Button type="submit" size="xs" className="text-[10px] shrink-0">
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-[10px] shrink-0"
                  onClick={() => {
                    setAddingGroup(false);
                    setNewGroupName('');
                    setGroupError(null);
                  }}
                >
                  ✕
                </Button>
              </form>
            )}

            <div className="rounded-md border divide-y">
              {groups.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  No groups yet.
                </p>
              ) : (
                groups.map((g) => (
                  <div key={g.id} className="px-3 py-2">
                    {editingGroupId === g.id ? (
                      <form
                        className="flex gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleUpdateGroup(g.id);
                        }}
                      >
                        <Input
                          ref={editGroupRef}
                          autoFocus
                          value={editGroupName}
                          onChange={(e) => setEditGroupName(e.target.value)}
                          className="h-7 text-xs px-2"
                        />
                        <Button
                          type="submit"
                          size="xs"
                          className="text-[10px] shrink-0"
                        >
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="text-[10px] shrink-0"
                          onClick={() => {
                            setEditingGroupId(null);
                            setGroupError(null);
                          }}
                        >
                          ✕
                        </Button>
                      </form>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-sm">
                          {g.name}
                          <span className="text-[10px] text-muted-foreground ml-1.5">
                            {g._count.suppliers}
                          </span>
                        </span>
                        <div className="flex gap-0.5">
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-[10px] h-5 px-1"
                            disabled={g._count.suppliers === 0}
                            title={
                              g._count.suppliers === 0
                                ? 'No suppliers in this group'
                                : 'Bulk-edit PO delivery schedule for all suppliers in this group'
                            }
                            onClick={() => {
                              setBulkDeliveryGroupId(g.id);
                              setGroupError(null);
                            }}
                          >
                            Schedule
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-[10px] h-5 px-1"
                            onClick={() => {
                              setEditingGroupId(g.id);
                              setEditGroupName(g.name);
                              setGroupError(null);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-[10px] h-5 px-1 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteGroup(g.id)}
                          >
                            Del
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right: Registered Suppliers + Form */}
        <div className="flex-1 min-w-0 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Registered Suppliers ({initial.length})
            </h2>
            <Button size="sm" className="text-xs" onClick={handleCreateNew}>
              + New Supplier
            </Button>
          </div>

          {showForm && (
            <div className="rounded-lg border bg-background p-4">
              <SupplierForm
                key={`create-${prefillVendor ?? ''}`}
                editing={null}
                prefillVendor={prefillVendor}
                vendors={vendors}
                groups={groups}
                defaultGroupId={defaultGroupId}
                onDone={handleDone}
              />
            </div>
          )}

          {optimisticSuppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No suppliers registered yet.
            </p>
          ) : (
            <div className="relative w-full overflow-auto rounded-md border">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b">
                  <tr className="border-b transition-colors hover:bg-muted/50">
                    {[
                      '',
                      'Company',
                      'Group',
                      'Vendor',
                      'Channel',
                      'Detail',
                      'POs',
                      '',
                    ].map((h, i) => (
                      <th
                        key={`${h}-${i}`}
                        className={cn(
                          'h-9 px-2 text-left align-middle text-xs font-medium text-muted-foreground',
                          i === 0 && 'w-8',
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {optimisticSuppliers.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
                      onClick={() => handleEdit(s)}
                    >
                      <td className="p-2 align-middle w-8">
                        <button
                          type="button"
                          className={cn(
                            'text-base leading-none transition-colors cursor-pointer',
                            s.isFavorite
                              ? 'text-amber-400 hover:text-amber-500'
                              : 'text-gray-300 hover:text-amber-400',
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(s.id);
                          }}
                        >
                          {s.isFavorite ? '★' : '☆'}
                        </button>
                      </td>
                      <td className="p-2 align-middle font-medium">
                        <span className="flex items-center gap-1.5">
                          {s.company}
                          {s.orderChannelType === 'order_link' && s.link && (
                            <a
                              href={s.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:text-blue-600 text-[10px]"
                              onClick={(e) => e.stopPropagation()}
                              title={s.link}
                            >
                              ↗
                            </a>
                          )}
                        </span>
                      </td>
                      <td className="p-2 align-middle">
                        {s.group ? (
                          <Badge
                            variant={s.group.slug === 'internal' ? 'purple' : 'gray'}
                            className="rounded px-1.5 text-[10px]"
                          >
                            {s.group.name}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-2 align-middle text-muted-foreground text-xs">
                        {(() => {
                          const locationPairs = s.vendorMappings.filter((m) => m.shopifyLocationGid);
                          const nullAliases = s.vendorMappings.filter((m) => !m.shopifyLocationGid);
                          if (locationPairs.length > 0) {
                            return (
                              <div className="flex flex-col gap-0.5">
                                {locationPairs.slice(0, 3).map((m) => (
                                  <span key={m.id} className="inline-flex items-center gap-0.5">
                                    <span className="font-medium text-foreground">{m.vendorName}</span>
                                    <span className="text-muted-foreground/60">@</span>
                                    <span>{m.shopifyLocationName ?? m.shopifyLocationGid}</span>
                                  </span>
                                ))}
                                {locationPairs.length > 3 && (
                                  <span className="text-[10px] text-muted-foreground/60">
                                    +{locationPairs.length - 3} more
                                  </span>
                                )}
                              </div>
                            );
                          }
                          return (
                            <>
                              <span>{s.shopifyVendorName ?? '—'}</span>
                              {nullAliases.length > 1 && (
                                <span className="ml-1 text-[10px] text-muted-foreground/60">
                                  +{nullAliases.length - 1} alias{nullAliases.length - 1 !== 1 ? 'es' : ''}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td className="p-2 align-middle">
                        <Badge
                          variant="gray"
                          className="rounded px-1.5 text-[10px] capitalize"
                        >
                          {s.orderChannelType === 'email'
                            ? 'Email'
                            : s.orderChannelType === 'order_link'
                              ? 'Link'
                              : 'Direct'}
                        </Badge>
                      </td>
                      <td className="p-2 align-middle text-xs text-muted-foreground max-w-[220px] truncate">
                        {s.orderChannelType === 'email'
                          ? s.contactEmails?.length
                            ? s.contactEmails.join(', ')
                            : '—'
                          : s.orderChannelType === 'order_link'
                            ? (s.link ?? '—')
                            : (() => {
                                const p = s.orderChannelPayload as {
                                  instruction?: string;
                                } | null;
                                const t = p?.instruction?.trim() ?? '';
                                return t
                                  ? t.length > 48
                                    ? `${t.slice(0, 48)}…`
                                    : t
                                  : '—';
                              })()}
                      </td>
                      <td className="p-2 align-middle text-right tabular-nums">
                        {s._count.purchaseOrders}
                      </td>
                      <td className="p-2 align-middle">
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-[10px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(s);
                          }}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Edit Supplier Dialog */}
      <GroupBulkDeliveryScheduleDialog
        open={bulkDeliveryGroupId !== null}
        onOpenChange={(open) => {
          if (!open) setBulkDeliveryGroupId(null);
        }}
        group={bulkDeliveryGroup}
        supplierCount={bulkGroupSupplierCount}
        seedScheduleRaw={bulkScheduleSeed}
        onApplied={() => router.refresh()}
      />

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="flex max-h-[min(90vh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
          <div className="shrink-0 space-y-1.5 border-b px-6 pt-6 pb-4 pr-14">
            <DialogHeader className="space-y-1.5 text-left">
              <DialogTitle>{editing?.company}</DialogTitle>
              <DialogDescription>
                {editing && (
                  <>
                    {editing._count.purchaseOrders} purchase order
                    {editing._count.purchaseOrders !== 1 && 's'}
                    {editing.shopifyVendorName &&
                      ` · Shopify vendor: ${editing.shopifyVendorName}`}
                    {editing.vendorMappings.length > 0 &&
                      ` · ${editing.vendorMappings.length} vendor alias${editing.vendorMappings.length !== 1 ? 'es' : ''}`}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
            {editing && (
              <SupplierForm
                key={editing.id}
                editing={editing}
                prefillVendor={null}
                vendors={vendors}
                groups={groups}
                onDone={handleDone}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
