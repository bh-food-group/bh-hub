'use client';

import { useState } from 'react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { laborApi, type PlanResult } from './api';
import { ScheduleTable } from './ScheduleTable';
import { usd, WEEKDAY_LABELS } from './format';

type Props = {
  locationId: string;
  date: string; // anchor date; the week containing it is generated
  onDateChange: (date: string) => void;
};

/** Sunday (dow=0) of the week containing `date`, as YYYY-MM-DD. */
function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return toIso(d);
}
function toIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
/** Short month/day label for a tab, e.g. "6/2". */
function md(dateIso: string): string {
  const [, m, d] = dateIso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function SchedulePanel({ locationId, date, onDateChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState<PlanResult[] | null>(null);
  const [selected, setSelected] = useState(0);
  const weekStart = weekStartOf(date);

  async function generate() {
    setLoading(true);
    try {
      const res = await laborApi.getWeekSchedule(locationId, weekStart);
      setPlans(res.plans);
      // Keep the anchor day selected within the week if possible.
      const idx = res.plans.findIndex((p) => p.date === date);
      setSelected(idx >= 0 ? idx : 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to generate week');
    } finally {
      setLoading(false);
    }
  }

  const plan = plans?.[selected] ?? null;
  const lowConfidence =
    plan?.sales?.sampleN?.some((n) => n > 0 && n < 3) ?? false;
  const noHistory =
    plan != null && (plan.sales?.s?.reduce((a, b) => a + b, 0) ?? 0) <= 0;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Generate weekly schedule</CardTitle>
          <p className="text-sm text-muted-foreground">
            Pick any day; the whole week (Sun–Sat) is generated. Week of{' '}
            {weekStart}.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="week-anchor">Week of</Label>
            <Input
              id="week-anchor"
              type="date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              className="w-44"
            />
          </div>
          <Button onClick={generate} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generate week
          </Button>
        </CardContent>
      </Card>

      {plans && (
        <>
          {/* Day tabs — one click switches the day shown below (no dropdown). */}
          <div className="flex flex-wrap gap-2">
            {plans.map((p, i) => {
              const dow = p.dow;
              const tone =
                p.status === 'BLOCKED'
                  ? 'border-destructive/60 text-destructive'
                  : p.status === 'OVER_BUDGET'
                    ? 'border-amber-500/60 text-amber-600'
                    : 'border-border';
              return (
                <button
                  key={p.date}
                  type="button"
                  onClick={() => setSelected(i)}
                  className={cn(
                    'flex min-w-20 flex-col items-center rounded-md border px-3 py-2 text-sm transition-colors',
                    tone,
                    selected === i
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent',
                  )}
                >
                  <span className="font-medium">{WEEKDAY_LABELS[dow]}</span>
                  <span
                    className={cn(
                      'text-xs',
                      selected === i
                        ? 'text-primary-foreground/80'
                        : 'text-muted-foreground',
                    )}
                  >
                    {md(p.date)}
                  </span>
                </button>
              );
            })}
          </div>

          {plan && (
            <DaySchedule
              plan={plan}
              lowConfidence={lowConfidence}
              noHistory={noHistory}
            />
          )}
        </>
      )}
    </div>
  );
}

function DaySchedule({
  plan,
  lowConfidence,
  noHistory,
}: {
  plan: PlanResult;
  lowConfidence: boolean;
  noHistory: boolean;
}) {
  return (
    <div className="space-y-4">
      {plan.status === 'BLOCKED' && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Fixed payroll exceeds the labor budget</AlertTitle>
          <AlertDescription>
            This day&apos;s share of fixed payroll consumes the entire labor
            budget — no PT labor fee to schedule against. Shortfall:{' '}
            {usd(plan.shortfall ?? 0)}.
          </AlertDescription>
        </Alert>
      )}

      {plan.status === 'OVER_BUDGET' && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Over budget — baseline coverage only</AlertTitle>
          <AlertDescription>
            The PT labor fee can&apos;t cover minimum staffing while open; the
            baseline is scheduled anyway. Overage:{' '}
            {usd(plan.engine?.coverage.overage ?? 0)}.
          </AlertDescription>
        </Alert>
      )}

      {noHistory && (
        <Alert>
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>No sales history for this weekday</AlertTitle>
          <AlertDescription>
            Coverage used uniform weights. Refresh the heatmap or override
            manually.
          </AlertDescription>
        </Alert>
      )}

      {lowConfidence && !noHistory && (
        <Alert>
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Low-confidence sales data</AlertTitle>
          <AlertDescription>
            Some hours have fewer than 3 samples in the trailing window.
          </AlertDescription>
        </Alert>
      )}

      {plan.engine && plan.status !== 'BLOCKED' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {plan.date} — recommended schedule
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Day forecast {usd(plan.dailyForecast)} · PT fee{' '}
              {usd(Math.max(0, plan.cascade.ptLaborFee))}
            </p>
          </CardHeader>
          <CardContent>
            <ScheduleTable
              table={plan.engine.table}
              wage={plan.settings.wage}
              ptLaborFee={Math.max(0, plan.cascade.ptLaborFee)}
              affordableHrs={plan.engine.coverage.affordableHrs}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
