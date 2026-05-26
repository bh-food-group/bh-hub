/**
 * Fetch a QuickBooks P&L report directly — no internal HTTP hop.
 *
 * Signature keeps `baseUrl` and `cookie` for backward compatibility with callers
 * that pass a QuickBooksApiContext, but they are no longer used.
 * All deduplication and caching is handled by fetchQbPnlCached.
 */

import { cache } from 'react';
import type { PnlReportData } from './parser';
import { fetchQbPnlCached } from './pnl-cache';

export type PnlApiResponse = {
  ok: boolean;
  locationId: string;
  location: { id: string; code: string | null; name: string | null };
  startDate: string;
  endDate: string;
  accountingMethod: 'Accrual' | 'Cash';
  report: PnlReportData;
};

export const fetchPnlReport = cache(async function fetchPnlReport(
  _baseUrl: string,
  _cookie: string | null,
  locationId: string,
  startDate: string,
  endDate: string,
  accountingMethod: 'Accrual' | 'Cash' = 'Accrual',
): Promise<PnlApiResponse> {
  const report = await fetchQbPnlCached(locationId, startDate, endDate, accountingMethod);
  return {
    ok: true,
    locationId,
    location: { id: locationId, code: null, name: null },
    startDate,
    endDate,
    accountingMethod,
    report,
  };
});
