'use client';

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { WeekRangeNav } from '@/components/ui/control/week-range-nav';
import { cn, formatCurrency } from '@/lib/utils';
import { format } from 'date-fns';
import { parseLocalDate } from '@/features/dashboard/revenue/utils/week-range';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import RevenueDailyBarChart from '../chart/RevenueDailyBarChart';
import HourlySalesHeatmap from '../chart/HourlySalesHeatmap';
import MenuPerformanceSection from '../chart/MenuPerformanceSection';
import WeeklyCloverStatsRow from '../chart/WeeklyCloverStatsRow';
import { getBcPublicHolidayDisplay } from '@/features/dashboard/revenue/utils/revenue-target-holidays';
import type { RevenuePeriodData } from '../types';

type WeeklyRevenueCardProps = {
  locationId: string;
  yearMonth: string;
  initialData?: RevenuePeriodData;
  initialWeekOffset: number;
  className?: string;
};

export default function WeeklyRevenueCard({
  locationId,
  yearMonth,
  initialData,
  initialWeekOffset,
  className,
}: WeeklyRevenueCardProps) {
  const [data, setData] = useState<RevenuePeriodData | null>(initialData ?? null);

  useEffect(() => {
    if (data?.cloverError) {
      console.error('[WeeklyRevenueCard] Clover error:', data.cloverError);
    }
  }, [data?.cloverError]);
  const [loading, setLoading] = useState(false);
  const [loadingMenuStats, setLoadingMenuStats] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (weekOffset: number) => {
      // Cancel any in-flight request so a slow initial load can't overwrite a later navigation.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      setLoading(true);
      setLoadingMenuStats(false);
      try {
        const base = new URLSearchParams({ locationId, yearMonth, weekOffset: String(weekOffset) });

        // Phase 1: current payments only (~1-2s). For cached past weeks, returns full data immediately.
        const res1 = await fetch(`/api/dashboard/revenue/clover?${base}&phase=1`, { cache: 'no-store', signal });
        const j1 = (await res1.json()) as { ok?: boolean; partial?: boolean; data?: RevenuePeriodData };
        if (!j1.ok || !j1.data) return;
        setData(j1.data);
        setLoading(false);

        // Phase 2: prevPayments + orderItems in parallel (~8s). Only needed when phase 1 was partial.
        if (j1.partial) {
          setLoadingMenuStats(true);
          const res2 = await fetch(`/api/dashboard/revenue/clover?${base}&phase=2`, { cache: 'no-store', signal });
          const j2 = (await res2.json()) as { ok?: boolean; data?: RevenuePeriodData };
          if (j2.ok && j2.data) setData(j2.data);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      } finally {
        if (!signal.aborted) {
          setLoading(false);
          setLoadingMenuStats(false);
        }
      }
    },
    [locationId, yearMonth],
  );

  useEffect(() => {
    if (!initialData) {
      void load(initialWeekOffset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWeekChange = useCallback(
    (weekOffset: number) => {
      void load(weekOffset);
    },
    [load],
  );

  return (
    <Card className={cn('min-w-0 overflow-hidden gap-2', className)}>
      <CardHeader className="space-y-1 pb-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <CardTitle className="text-base font-bold">
            Weekly Net Sales (Clover)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Pre-tax, pre-tip per successful payment
          </p>
        </div>
        {yearMonth != null && yearMonth !== '' && (
          <CardAction>
            <div className="flex items-center gap-2">
              {loading && (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}
              <WeekRangeNav
                key={`${yearMonth}-${initialWeekOffset}`}
                yearMonth={yearMonth}
                initialWeekOffset={initialWeekOffset}
                onWeekChange={onWeekChange}
                disabled={loading}
                previousAriaLabel="Previous week"
                nextAriaLabel="Next week"
              />
            </div>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {data === null ? (
          <div className="animate-pulse space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="h-12 rounded-lg bg-muted" />
              <div className="h-12 rounded-lg bg-muted" />
              <div className="h-12 rounded-lg bg-muted" />
            </div>
            <div className="h-44 rounded-lg bg-muted" />
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 rounded bg-muted" />
              ))}
            </div>
          </div>
        ) : (
        <div className={cn('relative', loading && 'pointer-events-none')}>
          <div
            className={cn(
              'transition-opacity duration-200',
              loading && 'opacity-40',
            )}
          >
            {data.cloverNotConfigured ? (
              <p className="text-sm text-muted-foreground">
                No Clover credentials configured for this location. Set the{' '}
                <span className="font-medium text-foreground">Clover Token</span>{' '}
                and{' '}
                <span className="font-medium text-foreground">Merchant ID</span>{' '}
                on the Locations page.
              </p>
            ) : data.cloverError ? (
              data.cloverError.includes('429') ? (
                <p className="text-sm text-muted-foreground">
                  Clover is rate-limiting requests right now. Wait a moment and{' '}
                  <button
                    className="font-medium text-foreground underline underline-offset-2"
                    onClick={() => void load(initialWeekOffset)}
                  >
                    refresh
                  </button>
                  .
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Clover error — check the browser console for details.
                </p>
              )
            ) : (
              <div className="space-y-5">
                {/* ── Row 1: Stats (full width) ── */}
                <WeeklyCloverStatsRow
                  totalRevenue={data.totalRevenue}
                  prevWeekRevenue={data.prevWeekRevenue}
                  transactionCount={data.transactionCount}
                  avgTicketSize={data.avgTicketSize}
                  wowCompareWeekdaySpanLabel={data.wowCompareWeekdaySpanLabel}
                />

                {/* ── Row 2: Bar chart + daily list | Menu performance ── */}
                {data.dailyBars &&
                  data.dailyBars.length > 0 &&
                  data.dailyBarSegmentKeys &&
                  data.dailyBarSegmentKeys.length > 0 &&
                  data.dailyBarSegmentLabels &&
                  data.dailyBarSegmentLabels.length ===
                    data.dailyBarSegmentKeys.length && (
                    <div className="grid gap-4 max-lg:grid-cols-1 grid-cols-2">
                      {/* Left: bar chart + daily list */}
                      <div className="space-y-3">
                        <RevenueDailyBarChart
                          rows={data.dailyBars}
                          segmentKeys={data.dailyBarSegmentKeys}
                          segmentLabels={data.dailyBarSegmentLabels}
                        />
                        <div className="divide-y rounded-lg border text-sm">
                          {data.dailyBars.map((row) => {
                            const pct =
                              data.totalRevenue > 0
                                ? (row.total / data.totalRevenue) * 100
                                : 0;
                            const holidayLabel = getBcPublicHolidayDisplay(row.date);
                            return (
                              <div
                                key={row.date}
                                className="flex items-center gap-3 px-3 py-2"
                              >
                                <span className="w-8 shrink-0 font-medium">
                                  {row.label}
                                </span>
                                <div className="flex min-w-0 max-w-[min(100%,13rem)] shrink items-center gap-2 sm:max-w-[16rem]">
                                  <span
                                    className={cn(
                                      'w-14 shrink-0 text-xs tabular-nums',
                                      holidayLabel
                                        ? 'font-medium text-destructive'
                                        : 'text-muted-foreground',
                                    )}
                                  >
                                    {format(parseLocalDate(row.date), 'MMM d')}
                                  </span>
                                  {holidayLabel ? (
                                    <span
                                      className="truncate text-xs font-medium text-destructive"
                                      title={holidayLabel}
                                    >
                                      {holidayLabel}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="flex flex-1 items-baseline justify-end gap-2">
                                  <span
                                    className={cn(
                                      'tabular-nums',
                                      row.total === 0
                                        ? 'text-muted-foreground'
                                        : 'font-medium',
                                    )}
                                  >
                                    {row.total === 0
                                      ? '—'
                                      : formatCurrency(row.total)}
                                  </span>
                                  {pct > 0 && (
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                      {pct.toFixed(1)}%
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right: menu performance */}
                      {loadingMenuStats ? (
                        <div className="animate-pulse space-y-3">
                          <div className="h-5 w-36 rounded bg-muted" />
                          {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="h-8 rounded bg-muted" />
                          ))}
                        </div>
                      ) : data.topMenuItems && data.topMenuItems.length > 0 ? (
                        <MenuPerformanceSection
                          topMenuItems={data.topMenuItems}
                          bottomMenuItems={data.bottomMenuItems ?? []}
                          seasonalMenuItems={data.seasonalMenuItems}
                        />
                      ) : null}
                    </div>
                  )}

                {/* ── Row 3: Hourly heatmap (full width) ── */}
                {data.dailyBars && data.dailyBars.length > 0 && (
                  <div className="rounded-lg border p-3">
                    <HourlySalesHeatmap
                      dayHourlySales={data.dayHourlySales ?? []}
                      weekDates={data.dailyBars.map((r) => ({
                        date: r.date,
                        label: r.label,
                      }))}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        )}
      </CardContent>
    </Card>
  );
}
