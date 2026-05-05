import type { PoEmailOutboundSettings } from './po-email-settings';
import {
  resolvePoEmailFromAddress,
  resolvePoEmailPublicContactAddress,
} from './po-email-settings';

/** Shipped with GET/PUT `/api/order/po-email-settings` — no secrets. */
export type PoEmailTransportMeta = {
  /** True when SMTP_HOST, SMTP_USER, and SMTP_PASS are all set (send may still fail if wrong). */
  smtpAuthConfigured: boolean;
  /** SMTP auth login mailbox from `SMTP_USER` (shown in settings UI for the sender field). */
  smtpUserEmail: string;
  /** RFC From address: `SMTP_FROM_EMAIL` → `SMTP_USER` → `PO_EMAIL_DEFAULT_SENDER`. */
  effectiveFromEmail: string;
  /** `{{replyEmail}}` / Reply-To target: `PO_EMAIL_DEFAULT_SENDER` or SMTP From/User. */
  publicContactEmail: string;
};

export function buildPoEmailTransportMeta(
  _settings: PoEmailOutboundSettings,
): PoEmailTransportMeta {
  const smtpUserEmail = (process.env.SMTP_USER ?? '').trim();
  return {
    smtpAuthConfigured: !!(
      process.env.SMTP_HOST?.trim() &&
      smtpUserEmail &&
      process.env.SMTP_PASS
    ),
    smtpUserEmail,
    effectiveFromEmail: resolvePoEmailFromAddress(),
    publicContactEmail: resolvePoEmailPublicContactAddress(),
  };
}
