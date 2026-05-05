'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils/cn';
import type { DeliveryLocationPresetRow } from './DeliveryLocationPresetPicker';

export type LocationOption = { id: string; code: string; name: string };

type Props = {
  locations: LocationOption[];
  initialPresets: DeliveryLocationPresetRow[];
};

const CA_PROVINCES = [
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
] as const;

export function DeliveryLocationPresetsClient({
  locations,
  initialPresets,
}: Props) {
  const [presets, setPresets] = useState(initialPresets);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [linkedLocationIds, setLinkedLocationIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [address1, setAddress1] = useState('');
  const [address2, setAddress2] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('BC');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('CA');

  const sorted = useMemo(
    () =>
      [...presets].sort((a, b) => {
        const ac = a.locations[0]?.code ?? '\uffff';
        const bc = b.locations[0]?.code ?? '\uffff';
        const c = ac.localeCompare(bc);
        if (c !== 0) return c;
        return a.name.localeCompare(b.name);
      }),
    [presets],
  );

  const toggleLocation = useCallback((id: string) => {
    setLinkedLocationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setLinkedLocationIds([]);
    setName('');
    setCompany('');
    setAddress1('');
    setAddress2('');
    setCity('');
    setProvince('BC');
    setPostalCode('');
    setCountry('CA');
    setDialogOpen(true);
  };

  const openEdit = (row: DeliveryLocationPresetRow) => {
    setEditingId(row.id);
    setLinkedLocationIds(row.locations.map((l) => l.id));
    setName(row.name);
    setCompany(row.company ?? '');
    setAddress1(row.address1);
    setAddress2(row.address2 ?? '');
    setCity(row.city);
    setProvince(row.province);
    setPostalCode(row.postalCode);
    setCountry(row.country || 'CA');
    setDialogOpen(true);
  };

  const refresh = useCallback(async () => {
    const res = await fetch('/api/order/delivery-location-presets');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(typeof data?.error === 'string' ? data.error : 'Load failed');
      return;
    }
    setPresets(Array.isArray(data.presets) ? data.presets : []);
  }, []);

  const handleSave = async () => {
    if (!name.trim() || !address1.trim() || !city.trim() || !postalCode.trim()) {
      toast.error('Name, address line 1, city, and postal code are required');
      return;
    }
    setSaving(true);
    try {
      const body = {
        locationIds: linkedLocationIds,
        name: name.trim(),
        company: company.trim() || null,
        address1: address1.trim(),
        address2: address2.trim() || null,
        city: city.trim(),
        province,
        postalCode: postalCode.trim(),
        country: country.trim() || 'CA',
      };
      const res = editingId
        ? await fetch(`/api/order/delivery-location-presets/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/order/delivery-location-presets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data?.error === 'string' ? data.error : 'Save failed');
        return;
      }
      toast.success(editingId ? 'Updated' : 'Created');
      setDialogOpen(false);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this delivery location preset?')) return;
    const res = await fetch(`/api/order/delivery-location-presets/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(typeof data?.error === 'string' ? data.error : 'Delete failed');
      return;
    }
    toast.success('Deleted');
    await refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Shared ship-to presets. Multiple{' '}
          <span className="font-medium text-foreground">Location</span> records can point
          to the same preset. Clear all links to keep an address that is not tied to any
          location. Search and pick these in POs and Shopify orders.
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Add preset
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[12rem]">Locations</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="w-[7rem] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-sm text-muted-foreground">
                  No presets yet.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs font-mono leading-snug">
                    {row.locations.length > 0
                      ? row.locations.map((l) => l.code).join(', ')
                      : '—'}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{row.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {[row.address1, row.city, row.province, row.postalCode]
                      .filter(Boolean)
                      .join(', ')}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Edit"
                      onClick={() => openEdit(row)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      aria-label="Delete"
                      onClick={() => void handleDelete(row.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit delivery preset' : 'New delivery preset'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1">
              <Label>Link locations (multi-select)</Label>
              {locations.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No locations in the database yet. Add locations first, then link them
                  here.
                </p>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded-md border px-2 py-1.5 space-y-1">
                  {locations.map((l) => (
                    <label
                      key={l.id}
                      className={cn(
                        'flex items-center gap-2 text-xs cursor-pointer rounded px-1 py-0.5',
                        'hover:bg-muted/50',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="h-3 w-3 rounded border-gray-300 shrink-0"
                        checked={linkedLocationIds.includes(l.id)}
                        onChange={() => toggleLocation(l.id)}
                      />
                      <span className="font-mono text-[11px]">{l.code}</span>
                      <span className="text-muted-foreground truncate">{l.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                Saving applies this preset as the default ship-to for every selected
                location.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Preset name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Company (optional)</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Address line 1</Label>
              <Input value={address1} onChange={(e) => setAddress1(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Address line 2</Label>
              <Input value={address2} onChange={(e) => setAddress2(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>City</Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Province</Label>
                <Select value={province} onValueChange={setProvince}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CA_PROVINCES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Postal code</Label>
                <Input
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Country (ISO2)</Label>
                <Input
                  value={country}
                  maxLength={2}
                  onChange={(e) => setCountry(e.target.value.toUpperCase())}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
