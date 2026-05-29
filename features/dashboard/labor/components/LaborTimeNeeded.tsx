'use client';

import { cn } from '@/lib/utils';
import { getDaysInMonth, parseISO, subMonths } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CloverDowAveragesData } from '../utils/get-clover-dow-averages';

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

/** BC minimum wage ($/hr). */
const MIN_WAGE = 18.3;

/** Payroll tax rate on the daily labor budget (CPP/EI/EHT/WCB estimate). */
const PAYROLL_TAX_RATE = 0.07;

type PrevMonthSummary = {
  totalLabor: number;
  managementFeeMonthly: number;
  insuranceMonthly: number;
};

type LaborTimeNeededProps = {
  locationId: string;
  yearMonth: string;
};

export default function LaborTimeNeeded({
  locationId,
  yearMonth,
}: LaborTimeNeededProps) {
  const [dowState, setDowState] = useState<CloverDowAveragesData | null>(null);
  const [summary, setSummary] = useState<PrevMonthSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setDowState(null);
    setSummary(null);

    const q = new URLSearchParams({ locationId, yearMonth });

    // Fetch both in parallel — Clover DOW averages + prev month QB labor summary.
    // AbortController cancels server-side requests on unmount (e.g. month navigation)
    // so long-running Clover/QB calls don't hold DB connections after the user leaves.
    Promise.all([
      fetch(`/api/dashboard/labor/clover/dow-averages?${q.toString()}`, { cache: 'no-store', signal: ac.signal })
        .then((r) => r.json() as Promise<CloverDowAveragesData & { ok?: boolean }>),
      fetch(`/api/dashboard/labor/prev-month-summary?${q.toString()}`, { cache: 'no-store', signal: ac.signal })
        .then((r) => r.json() as Promise<PrevMonthSummary & { ok?: boolean }>),
    ])
      .then(([dow, sum]) => {
        setDowState(dow);
        if (sum.ok) setSummary(sum);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });

    return () => ac.abort();
  }, [locationId, yearMonth]);

  // Previous month's day count — everything references last month.
  const daysInRefMonth = getDaysInMonth(subMonths(parseISO(`${yearMonth}-01`), 1));
  const managementFeeDaily = (summary?.managementFeeMonthly ?? 0) / daysInRefMonth;
  const insuranceDaily = (summary?.insuranceMonthly ?? 0) / daysInRefMonth;

  const hoursNeeded: (number | null)[] =
    dowState?.dowAverages.length === 7 && summary != null
      ? (() => {
          const sumAllDowAvg = dowState.dowAverages.reduce(
            (s, d) => s + d.avgNetSales,
            0,
          );
          const estimatedMonthlyNetSales = (sumAllDowAvg / 7) * daysInRefMonth;

          return dowState.dowAverages.map((d) => {
            const laborDay =
              estimatedMonthlyNetSales > 0
                ? summary.totalLabor * (d.avgNetSales / estimatedMonthlyNetSales)
                : 0;
            const taxForDay = laborDay * PAYROLL_TAX_RATE;
            const available =
              laborDay - managementFeeDaily - insuranceDaily - taxForDay;
            return available > 0 ? available / MIN_WAGE : 0;
          });
        })()
      : new Array(7).fill(null);

  const refLabel = dowState?.refYearMonth ?? null;

  return (
    <div className="rounded-xl bg-zinc-900 px-3 py-4 text-white shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <span className="rounded-full bg-white px-4 py-1 text-xs font-semibold text-zinc-900">
          Time Needed
        </span>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="size-3 animate-spin text-zinc-400" />}
          {refLabel && !loading && (
            <span className="text-[10px] text-zinc-500">ref {refLabel}</span>
          )}
        </div>
      </div>

      {dowState?.cloverNotConfigured ? (
        <p className="text-center text-xs text-zinc-400">
          No Clover credentials configured.
        </p>
      ) : dowState?.cloverError ? (
        <p className="text-center text-xs text-zinc-400">
          {dowState.cloverError.includes('429')
            ? 'Clover rate-limited. Try again shortly.'
            : 'Could not load Clover data.'}
        </p>
      ) : (
        <div
          className={cn(
            'grid grid-cols-7 gap-1 text-center sm:gap-2',
            loading && 'opacity-40',
          )}
        >
          {DAY_LABELS.map((label, i) => {
            const h = hoursNeeded[i];
            return (
              <div key={label} className="flex min-w-0 flex-col items-center gap-1">
                <span className="text-[10px] font-medium text-zinc-400 sm:text-xs">
                  {label}
                </span>
                <span className="text-lg font-bold tabular-nums">
                  {h == null ? (
                    <span className="text-zinc-600 text-base">—</span>
                  ) : (
                    <>
                      {Math.round(h)}
                      <span className="text-sm">h</span>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
