'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { PoEmailOutboundSettings } from '@/lib/order/po-email-settings';
import { DEFAULT_PO_EMAIL_OUTBOUND } from '@/lib/order/po-email-settings';
import type { PoEmailTransportMeta } from '@/lib/order/po-email-transport-meta';

type LoadState = 'idle' | 'loading' | 'error';

type SettingsApiPayload = PoEmailOutboundSettings & {
  transport?: PoEmailTransportMeta;
};

function splitPayload(body: SettingsApiPayload): {
  settings: PoEmailOutboundSettings;
  transport: PoEmailTransportMeta | null;
} {
  const { transport, ...rest } = body;
  return {
    settings: rest,
    transport: transport ?? null,
  };
}

type SettingsErrorBody = {
  error?: string;
  code?: string;
  hint?: string;
};

export function PoEmailSettingsForm() {
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorExtra, setLoadErrorExtra] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [transport, setTransport] = useState<PoEmailTransportMeta | null>(null);

  const [form, setForm] = useState<PoEmailOutboundSettings>(
    DEFAULT_PO_EMAIL_OUTBOUND,
  );

  const load = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    setLoadErrorExtra(null);
    try {
      const res = await fetch('/api/order/po-email-settings');
      const body = (await res.json().catch(() => ({}))) as SettingsApiPayload &
        SettingsErrorBody;
      if (!res.ok) {
        const msg =
          typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
        const code = typeof body.code === 'string' ? body.code : null;
        const hint = typeof body.hint === 'string' ? body.hint : null;
        setLoadError(msg);
        const extra = [code ? `Code: ${code}` : null, hint]
          .filter(Boolean)
          .join(' ');
        setLoadErrorExtra(extra.length > 0 ? extra : null);
        setLoadState('error');
        return;
      }
      const { settings, transport: t } = splitPayload(body);
      setForm(settings);
      setTransport(t);
      setLoadState('idle');
    } catch {
      setLoadError(
        'Could not reach the server or the response was not JSON. Check that the app is running.',
      );
      setLoadErrorExtra(null);
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    setSavedFlash(false);
    try {
      const res = await fetch('/api/order/po-email-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          ccEmail: form.ccEmail?.trim() || null,
        }),
      });
      const body = (await res
        .json()
        .catch(() => ({}))) as SettingsApiPayload & {
        error?: string;
      };
      if (!res.ok) {
        setSaveError(
          typeof body.error === 'string' ? body.error : `HTTP ${res.status}`,
        );
        return;
      }
      const { settings, transport: t } = splitPayload(body);
      setForm(settings);
      setTransport(t);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch {
      setSaveError('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border bg-background p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">PO supplier email (outbound)</h2>
        <p className="text-xs text-muted-foreground mt-1">
          On open (and Retry), this form loads your saved subject, intro,
          signature, CC, and display name from the hub database via{' '}
          <code className="text-[10px] bg-muted px-1 rounded">
            GET /api/order/po-email-settings
          </code>
          . SMTP values below are read from env only and are not part of that
          request.
        </p>
        <p className="text-xs text-muted-foreground mt-1.5">
          Used when sending a purchase order PDF to suppliers. Intro template
          supports{' '}
          <code className="text-[10px] bg-muted px-1 rounded">
            {'{{supplierName}}'}
          </code>{' '}
          and{' '}
          <code className="text-[10px] bg-muted px-1 rounded">
            {'{{poNumber}}'}
          </code>
          ; use{' '}
          <code className="text-[10px] bg-muted px-1 rounded">
            {'{{replyEmail}}'}
          </code>{' '}
          for the public contact line (from{' '}
          <code className="text-[10px] bg-muted px-1 rounded">
            PO_EMAIL_DEFAULT_SENDER
          </code>{' '}
          or SMTP From/User). Subject only needs{' '}
          <code className="text-[10px] bg-muted px-1 rounded">
            {'{{poNumber}}'}
          </code>
          .
        </p>
      </div>

      {loadState === 'loading' && (
        <p className="text-xs text-muted-foreground" role="status">
          Loading saved PO email settings…
        </p>
      )}
      {loadState === 'error' && loadError && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive space-y-1.5"
          role="alert"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium text-destructive">
              Could not load saved settings
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void load()}
            >
              Retry
            </Button>
          </div>
          <p className="text-destructive/95 leading-snug">{loadError}</p>
          {loadErrorExtra ? (
            <p className="text-[11px] text-destructive/80 leading-snug">
              {loadErrorExtra}
            </p>
          ) : null}
        </div>
      )}

      <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed space-y-1.5">
        <p className="font-medium text-foreground/90">
          SMTP (server environment)
        </p>
        <p>
          Sending uses{' '}
          <code className="text-[10px] bg-background px-1 rounded">
            SMTP_HOST
          </code>
          ,{' '}
          <code className="text-[10px] bg-background px-1 rounded">
            SMTP_PORT
          </code>
          ,{' '}
          <code className="text-[10px] bg-background px-1 rounded">
            SMTP_USER
          </code>
          , and{' '}
          <code className="text-[10px] bg-background px-1 rounded">
            SMTP_PASS
          </code>{' '}
          from{' '}
          <code className="text-[10px] bg-background px-1 rounded">.env</code> —
          not stored in the database. The login user is usually the same mailbox
          as the provider allows for From; many relays reject a From address
          that does not match that account.
        </p>
        <p>
          Optional: set{' '}
          <code className="text-[10px] bg-background px-1 rounded">
            SMTP_FROM_EMAIL
          </code>{' '}
          to override the From address (otherwise{' '}
          <code className="text-[10px] bg-background px-1 rounded">
            SMTP_USER
          </code>{' '}
          is used). If From differs from the public contact (see{' '}
          <code className="text-[10px] bg-background px-1 rounded">
            PO_EMAIL_DEFAULT_SENDER
          </code>{' '}
          / SMTP), Reply-To is set to that public address automatically.
        </p>
      </div>

      {transport && !transport.smtpAuthConfigured && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"
          role="status"
        >
          SMTP credentials look incomplete in env (host / user / password). Mail
          send will fail until <code className="text-[10px]">.env</code> is
          configured and the app restarted.
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-col gap-4 sm:grid sm:grid-cols-2 sm:items-start sm:gap-x-4">
          <div className="grid gap-1.5">
            <Label htmlFor="po-sender-name" className="text-xs">
              Sender display name
            </Label>
            <Input
              id="po-sender-name"
              className="h-9 text-sm"
              value={form.senderName}
              onChange={(e) =>
                setForm((f) => ({ ...f, senderName: e.target.value }))
              }
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="po-from-address" className="text-xs">
              Sender email (From)
            </Label>
            <Input
              id="po-from-address"
              type="email"
              className="h-9 text-sm bg-muted/50"
              disabled
              readOnly
              value={transport?.smtpUserEmail?.trim() ?? ''}
              placeholder={transport?.smtpUserEmail?.trim() ?? ''}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-4">
          <div className="hidden sm:block" aria-hidden />
          <div className="space-y-1.5 min-w-0">
            <p className="text-[10px] text-muted-foreground leading-snug">
              This field shows{' '}
              <code className="bg-muted px-0.5 rounded">SMTP_USER</code> when
              set (SMTP login). Actual RFC From when sending is{' '}
              <code className="bg-muted px-0.5 rounded">SMTP_FROM_EMAIL</code>,
              else <code className="bg-muted px-0.5 rounded">SMTP_USER</code>,
              else{' '}
              <code className="bg-muted px-0.5 rounded">
                PO_EMAIL_DEFAULT_SENDER
              </code>{' '}
              — not editable here; change env and restart the app.
              {transport?.smtpUserEmail?.trim() &&
              transport.effectiveFromEmail &&
              transport.smtpUserEmail.trim().toLowerCase() !==
                transport.effectiveFromEmail.toLowerCase() ? (
                <>
                  {' '}
                  <span className="font-mono text-foreground/80">
                    From: {transport.effectiveFromEmail}
                  </span>
                </>
              ) : null}
            </p>
            {transport?.publicContactEmail &&
              transport.publicContactEmail !== transport.effectiveFromEmail && (
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Reply-To when sending:{' '}
                  <span className="font-mono text-foreground/80">
                    {transport.publicContactEmail}
                  </span>
                </p>
              )}
          </div>
        </div>
        <div className="grid gap-1.5 max-w-md">
          <Label htmlFor="po-cc-email" className="text-xs">
            CC email (optional)
          </Label>
          <Input
            id="po-cc-email"
            type="email"
            className="h-9 text-sm"
            placeholder="work@example.com"
            value={form.ccEmail ?? ''}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                ccEmail: e.target.value.trim() ? e.target.value : null,
              }))
            }
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="po-subject-tpl" className="text-xs">
          Subject template
        </Label>
        <Input
          id="po-subject-tpl"
          className="h-9 text-sm font-mono text-xs"
          value={form.subjectTemplate}
          onChange={(e) =>
            setForm((f) => ({ ...f, subjectTemplate: e.target.value }))
          }
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="po-intro-tpl" className="text-xs">
          Body — intro (before signature)
        </Label>
        <Textarea
          id="po-intro-tpl"
          rows={8}
          className="text-xs font-mono min-h-[120px]"
          value={form.bodyIntroTemplate}
          onChange={(e) =>
            setForm((f) => ({ ...f, bodyIntroTemplate: e.target.value }))
          }
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="po-sig-tpl" className="text-xs">
          Body — signature / footer
        </Label>
        <Textarea
          id="po-sig-tpl"
          rows={14}
          className="text-xs font-mono min-h-[200px]"
          value={form.bodySignatureTemplate}
          onChange={(e) =>
            setForm((f) => ({ ...f, bodySignatureTemplate: e.target.value }))
          }
        />
      </div>

      {saveError && (
        <p className="text-xs text-destructive" role="alert">
          {saveError}
        </p>
      )}
      {savedFlash && <p className="text-xs text-green-700">Saved.</p>}

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          className="text-xs"
          disabled={saving || loadState === 'loading'}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : 'Save PO email settings'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs"
          disabled={saving}
          onClick={() => {
            setForm(DEFAULT_PO_EMAIL_OUTBOUND);
          }}
        >
          Reset form to defaults
        </Button>
      </div>
    </div>
  );
}
