'use client';

import { QB_REFRESH_EXPIRED } from '@/constants/error';
import type { BudgetDataType } from '@/features/dashboard/budget';
import BudgetCard from '@/features/dashboard/budget/components/card/BudgetCard';
import type { LaborDashboardData } from '@/features/dashboard/labor';
import LaborCard from '@/features/dashboard/labor/components/card/LaborCard';
import type { RevenuePeriodData } from '@/features/dashboard/revenue/components/types';
import AnnualRevenueCard from '@/features/dashboard/revenue/components/card/AnnualRevenueCard';
import MonthlyRevenueCard from '@/features/dashboard/revenue/components/card/MonthlyRevenueCard';
import WeeklyRevenueCard from '@/features/dashboard/revenue/components/card/WeeklyRevenueCard';
import {
  BudgetSkeleton,
  LaborSkeleton,
  RevenueCardSkeleton,
} from './DashboardCardsSkeleton';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getCurrentYearMonth } from '@/lib/utils';
import {
  clampWeekOffsetForDashboard,
  getWeekOffsetContainingToday,
} from '@/features/dashboard/revenue/utils/week-range';

type CardData = {
  partial: boolean;
  budget: BudgetDataType | null;
  noBudgetReason?: string;
  labor: LaborDashboardData | null;
  monthlyRevenue: (RevenuePeriodData & { monthlyRevenueTarget?: number }) | null;
  annualRevenue: RevenuePeriodData | null;
  revenueSnapshot: { annualGoal: number; monthlyTarget: number } | null;
  savedRefMonths: number | null;
};

export default function LocationDashboardCards() {
  const params = useParams<{ id: string }>();
  const locationId = params?.id ?? '';
  const searchParams = useSearchParams();
  const yearMonth = searchParams?.get('yearMonth') ?? getCurrentYearMonth();
  const { data: session } = useSession();
  const role = session?.user?.role?.toLowerCase() ?? '';
  const isOfficeOrAdmin = role === 'admin' || role === 'office';
  const [data, setData] = useState<CardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tracks the highest phase applied — prevents a slow phase 1 from overwriting a fast phase 2.
  const highestPhaseRef = useRef(0);

  // Compute initialWeekOffset client-side — same logic as the server — so WeeklyRevenueCard
  // can mount and start its Clover fetch immediately, without waiting for location-cards.
  const initialWeekOffset = useMemo(
    () => clampWeekOffsetForDashboard(yearMonth, getWeekOffsetContainingToday(yearMonth)),
    [yearMonth],
  );

  useEffect(() => {
    const controller = new AbortController();
    highestPhaseRef.current = 0;
    setData(null);
    setError(null);

    const fetchPhase = async (phase: 1 | 2) => {
      const qs = new URLSearchParams({ locationId, yearMonth, phase: String(phase) });
      try {
        const res = await fetch(`/api/dashboard/location-cards?${qs}`, { signal: controller.signal });
        const json = await res.json() as { ok?: boolean; error?: string } & Partial<CardData>;
        if (json.ok) {
          if (phase >= highestPhaseRef.current) {
            highestPhaseRef.current = phase;
            setData(json as CardData);
          }
        } else if (phase === 2) {
          setError(json.error ?? 'Failed to load dashboard data');
        }
      } catch (err: unknown) {
        if ((err as { name?: string })?.name !== 'AbortError' && phase === 2) {
          setError('Failed to load dashboard data');
        }
      }
    };

    // Fire phase 1 first, then phase 2 after it resolves.
    // Sequential avoids Supabase connection pool contention: both phases run fetchBaseData
    // (same DB queries). If fired concurrently, phase 2 waits in the pool queue (~3-4s).
    // Phase 1 releases its connections in ~150ms, so phase 2 DB work is uncontested.
    void fetchPhase(1).then(() => fetchPhase(2));

    return () => controller.abort();
  }, [locationId, yearMonth]);

  const revenueReady = data != null && data.monthlyRevenue != null && data.annualRevenue != null;

  return (
    <div className="grid gap-4 max-lg:grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
      {/* Left column */}
      <div className="flex min-w-0 flex-col gap-4 lg:min-h-0">
        {/* Annual + Monthly revenue:
            - no data yet → skeleton
            - data but no budget → no-budget message
            - budget present, QB not done (partial) → skeleton
            - QB done → cards */}
        {error ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {error}
          </div>
        ) : !data || (!data.budget && data.partial) ? (
          <div className="flex gap-4 [&>*]:flex-1">
            <RevenueCardSkeleton />
            <RevenueCardSkeleton />
          </div>
        ) : !data.budget ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
            <p>{data.noBudgetReason ?? 'No budget for this month.'}</p>
            <p className="mt-1 text-sm">Select a different month to view budget.</p>
          </div>
        ) : !revenueReady ? (
          <div className="flex gap-4 [&>*]:flex-1">
            <RevenueCardSkeleton />
            <RevenueCardSkeleton />
          </div>
        ) : (
          <div className="flex gap-4 [&>*]:flex-1">
            <AnnualRevenueCard
              data={data.annualRevenue!}
              annualGoal={data.revenueSnapshot?.annualGoal}
              locationId={locationId}
              appliesYearMonth={yearMonth}
              showUpdateTarget={isOfficeOrAdmin}
            />
            <MonthlyRevenueCard
              data={data.monthlyRevenue!}
              locationId={locationId}
              appliesYearMonth={yearMonth}
              showUpdateTarget={isOfficeOrAdmin}
              savedRefMonths={data.savedRefMonths}
            />
          </div>
        )}

        {/* Weekly revenue — starts immediately, parallel with location-cards fetch */}
        <WeeklyRevenueCard
          key={yearMonth}
          locationId={locationId}
          yearMonth={yearMonth}
          initialWeekOffset={initialWeekOffset}
        />
      </div>

      {/* Right column: BudgetCard renders on phase 1 (~150ms); LaborCard waits for phase 2. */}
      <div className="flex min-w-0 flex-col gap-4">
        {!error && !data && (
          <>
            <BudgetSkeleton />
            <LaborSkeleton />
          </>
        )}
        {!error && data?.budget && (
          <>
            <BudgetCard
              budget={data.budget}
              isOfficeOrAdmin={isOfficeOrAdmin}
              yearMonth={yearMonth}
              needsReconnect={data.budget.error === QB_REFRESH_EXPIRED}
            />
            {data.labor ? (
              <LaborCard
                data={data.labor}
                locationId={locationId}
                yearMonth={yearMonth}
                isOfficeOrAdmin={isOfficeOrAdmin}
              />
            ) : (
              <LaborSkeleton />
            )}
          </>
        )}
      </div>
    </div>
  );
}
