/**
 * QuickBooks company API fetchers.
 * - Company info (GET /v3/company/{realmId}/companyinfo/{realmId}) — used when creating a new Realm.
 * - P&L report (GET .../reports/ProfitAndLoss) — used by /api/quickbooks route handlers.
 * All HTTP requests to the QuickBooks company API should be triggered from routes.
 */

import { decryptRefreshToken } from '@/lib/core/encryption';
import { AppError } from '@/lib/core/errors';
import { getQuickBooksReportBaseUrl } from './config';
import { qbAbortStore } from './abort-signal-store';
import type { QuickBooksProfitAndLossRaw } from './parser';

const QB_COMPANY_INFO_TIMEOUT_MS = 10_000;
const QB_REPORT_TIMEOUT_MS = 25_000;

// ---------- Company info ----------

export type QuickBooksCompanyInfoResponse = {
  CompanyInfo?: {
    CompanyName?: string;
    Id?: string;
    [key: string]: unknown;
  };
};

/**
 * Returns company name from QuickBooks (GET /v3/company/{realmId}/companyinfo/{realmId}),
 * or null if the request fails. realmId and accessToken must be for the same company.
 */
export async function getQuickBooksCompanyName(
  realmId: string,
  accessToken: string,
): Promise<string | null> {
  const base = getQuickBooksReportBaseUrl();
  const url = `${base}/v3/company/${realmId}/companyinfo/${realmId}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    QB_COMPANY_INFO_TIMEOUT_MS,
  );
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
  clearTimeout(timeoutId);

  if (!res.ok) return null;

  try {
    const data = (await res.json()) as QuickBooksCompanyInfoResponse;
    const name = data?.CompanyInfo?.CompanyName;
    return typeof name === 'string' && name.trim().length > 0
      ? name.trim()
      : null;
  } catch {
    return null;
  }
}

// ---------- P&L report ----------

export async function fetchProfitAndLossReportFromQb(
  realmId: string,
  startDate: string,
  endDate: string,
  accountingMethod: 'Accrual' | 'Cash',
  accessToken: string,
  classId?: string,
  summarizeColumnsBy?: string,
): Promise<QuickBooksProfitAndLossRaw> {
  const resolvedRealmId = decryptRefreshToken(realmId);
  const base = getQuickBooksReportBaseUrl();
  let url = `${base}/v3/company/${resolvedRealmId}/reports/ProfitAndLoss?start_date=${startDate}&end_date=${endDate}&accounting_method=${accountingMethod}`;
  if (classId) url += `&class=${encodeURIComponent(classId)}`;
  if (summarizeColumnsBy) url += `&summarize_column_by=${encodeURIComponent(summarizeColumnsBy)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QB_REPORT_TIMEOUT_MS);
  const requestSignal = qbAbortStore.getStore();
  const signal = requestSignal
    ? AbortSignal.any([controller.signal, requestSignal])
    : controller.signal;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === 'AbortError') {
      throw new AppError(
        'QuickBooks P&L request timed out. The service may be slow or unreachable.',
      );
    }
    throw e;
  }
  clearTimeout(timeoutId);

  if (res.status === 401) {
    const err = await res.text();
    throw new AppError(
      `QuickBooks P&L request failed: 401 Unauthorized. ${err}. ` +
        "Ensure this app uses the same QuickBooks client id/secret as the connection, and that the location's realmId matches the connected company. Try reconnecting QuickBooks for this location.",
    );
  }

  if (!res.ok) {
    const err = await res.text();
    throw new AppError(`QuickBooks P&L request failed: ${res.status} ${err}`);
  }

  return (await res.json()) as QuickBooksProfitAndLossRaw;
}
