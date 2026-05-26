/**
 * Shared QuickBooks P&L cache — call QB directly without an internal HTTP hop.
 *
 * Two TTL tiers:
 *   - Current month (endDate >= this month): 5 min — data changes as transactions post.
 *   - Past months  (endDate <  this month): 24 h  — immutable, safe to cache long-term.
 *
 * unstable_cache: persists across requests (keyed by args).
 * React.cache:   deduplicates identical in-flight calls within a single request,
 *                so e.g. currentCOS + monthlyRevenue + labor (all same month) cost
 *                exactly one QB round-trip.
 */

import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { fetchProfitAndLossReportFromQb } from './fetcher';
import { withValidTokenForLocation } from './oauth';
import type { QuickBooksProfitAndLossRaw } from './parser';

const _fetchPnlUncached = async (
  locationId: string,
  startDate: string,
  endDate: string,
  accountingMethod: 'Accrual' | 'Cash',
): Promise<QuickBooksProfitAndLossRaw> =>
  withValidTokenForLocation(locationId, (accessToken, realmId, classId) =>
    fetchProfitAndLossReportFromQb(
      realmId,
      startDate,
      endDate,
      accountingMethod,
      accessToken,
      classId,
    ),
  );

// 5-min cache for current month (data changes as transactions post).
const _fetchPnlCurrent = unstable_cache(_fetchPnlUncached, ['qb-pnl'], {
  revalidate: 300,
  tags: ['qb-pnl'],
});

// 24-hour cache for past months (immutable).
const _fetchPnlPast = unstable_cache(_fetchPnlUncached, ['qb-pnl-past'], {
  revalidate: 86400,
  tags: ['qb-pnl'],
});

async function _fetchPnlDispatch(
  locationId: string,
  startDate: string,
  endDate: string,
  accountingMethod: 'Accrual' | 'Cash',
): Promise<QuickBooksProfitAndLossRaw> {
  const todayYM = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const isPast = endDate.slice(0, 7) < todayYM;
  return isPast
    ? _fetchPnlPast(locationId, startDate, endDate, accountingMethod)
    : _fetchPnlCurrent(locationId, startDate, endDate, accountingMethod);
}

/** Fetch a QB P&L report with request-level dedup + TTL-tiered persistent cache. */
export const fetchQbPnlCached = cache(_fetchPnlDispatch);
