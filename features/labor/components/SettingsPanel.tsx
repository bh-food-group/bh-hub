'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { laborApi, type ResolvedLaborSettings } from './api';
import { hourLabel } from './format';

type Props = { locationId: string; canEdit: boolean };

type FormState = {
  budgetPct: string;
  wage: string;
  minCov: string;
  maxCov: string;
  minShiftHrs: string;
  maxShiftHrs: string;
  increment: string;
  openHour: string;
  closeHour: string;
};

function toForm(s: ResolvedLaborSettings): FormState {
  return {
    budgetPct: String(s.budgetPct),
    wage: String(s.wage),
    minCov: String(s.minCov),
    maxCov: String(s.maxCov),
    minShiftHrs: String(s.minShiftHrs),
    maxShiftHrs: String(s.maxShiftHrs),
    increment: String(s.increment),
    openHour: String(s.openHour),
    closeHour: String(s.closeHour),
  };
}

export function SettingsPanel({ locationId, canEdit }: Props) {
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bcMin, setBcMin] = useState(0);
  const [configured, setConfigured] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await laborApi.getSettings(locationId);
      setForm(toForm(res.settings));
      setBcMin(res.bcMinimumWage);
      setConfigured(res.settings.configured);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function save() {
    if (!form) return;
    const payload = {
      location: locationId,
      budgetPct: Number.parseFloat(form.budgetPct),
      wage: Number.parseFloat(form.wage),
      minCov: Number.parseInt(form.minCov, 10),
      maxCov: Number.parseInt(form.maxCov, 10),
      minShiftHrs: Number.parseFloat(form.minShiftHrs),
      maxShiftHrs: Number.parseFloat(form.maxShiftHrs),
      increment: Number.parseFloat(form.increment),
      openHour: Number.parseInt(form.openHour, 10),
      closeHour: Number.parseInt(form.closeHour, 10),
    };
    if (Object.values(payload).some((v) => typeof v === 'number' && Number.isNaN(v))) {
      toast.error('All fields are required and must be numbers');
      return;
    }
    setSaving(true);
    try {
      await laborApi.saveSettings(payload);
      toast.success('Settings saved');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !form) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
      </div>
    );
  }

  const wageNum = Number.parseFloat(form.wage);
  const wageBelowMin = Number.isFinite(wageNum) && wageNum < bcMin;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Module settings</CardTitle>
        <p className="text-sm text-muted-foreground">
          {configured
            ? 'These drive the budget cascade and the scheduling engine.'
            : 'Using defaults — save to create this location’s settings.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumField
            id="budgetPct"
            label="Budget %"
            hint="Labor budget = forecast × this (0–1)"
            value={form.budgetPct}
            onChange={(v) => set('budgetPct', v)}
            disabled={!canEdit}
            step="0.01"
          />
          <NumField
            id="wage"
            label="PT wage ($/hr)"
            hint={`BC minimum: $${bcMin.toFixed(2)}`}
            value={form.wage}
            onChange={(v) => set('wage', v)}
            disabled={!canEdit}
            step="0.05"
          />
          <NumField
            id="increment"
            label="Increment (hrs)"
            hint="1.0 (MVP) or 0.5"
            value={form.increment}
            onChange={(v) => set('increment', v)}
            disabled={!canEdit}
            step="0.5"
          />
          <NumField
            id="minCov"
            label="Min coverage"
            hint="Staff on while open"
            value={form.minCov}
            onChange={(v) => set('minCov', v)}
            disabled={!canEdit}
            step="1"
          />
          <NumField
            id="maxCov"
            label="Max coverage"
            hint="Physical cap"
            value={form.maxCov}
            onChange={(v) => set('maxCov', v)}
            disabled={!canEdit}
            step="1"
          />
          <NumField
            id="minShiftHrs"
            label="Min shift (hrs)"
            hint="Confirm vs BC Employment Standards"
            value={form.minShiftHrs}
            onChange={(v) => set('minShiftHrs', v)}
            disabled={!canEdit}
            step="0.5"
          />
          <NumField
            id="maxShiftHrs"
            label="Max shift (hrs)"
            value={form.maxShiftHrs}
            onChange={(v) => set('maxShiftHrs', v)}
            disabled={!canEdit}
            step="0.5"
          />
          <NumField
            id="openHour"
            label="Open hour (0–23)"
            hint={`${hourLabel(Number.parseInt(form.openHour, 10) || 0)}`}
            value={form.openHour}
            onChange={(v) => set('openHour', v)}
            disabled={!canEdit}
            step="1"
          />
          <NumField
            id="closeHour"
            label="Close hour (0–23, inclusive)"
            hint={`${hourLabel(Number.parseInt(form.closeHour, 10) || 0)}`}
            value={form.closeHour}
            onChange={(v) => set('closeHour', v)}
            disabled={!canEdit}
            step="1"
          />
        </div>

        {wageBelowMin && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <TriangleAlert className="h-4 w-4" />
            Wage is below the BC minimum (${bcMin.toFixed(2)}).
          </p>
        )}

        {canEdit ? (
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save settings
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only office/admin can edit settings.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function NumField({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
  step,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
