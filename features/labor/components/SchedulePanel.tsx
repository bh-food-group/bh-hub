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
import { laborApi, type PlanResult } from './api';
import { ScheduleTable } from './ScheduleTable';
import { usd } from './format';

type Props = {
  locationId: string;
  date: string;
  onDateChange: (date: string) => void;
};

export function SchedulePanel({ locationId, date, onDateChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<PlanResult | null>(null);

  async function generate() {
    setLoading(true);
    try {
      const res = await laborApi.generatePlan(locationId, date);
      setPlan(res.plan);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to generate plan');
    } finally {
      setLoading(false);
    }
  }

  const lowConfidence =
    plan?.sales?.sampleN?.some((n) => n > 0 && n < 3) ?? false;
  const noHistory =
    plan != null && (plan.sales?.s?.reduce((a, b) => a + b, 0) ?? 0) <= 0;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Generate schedule</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="schedule-date">Date</Label>
            <Input
              id="schedule-date"
              type="date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              className="w-44"
            />
          </div>
          <Button onClick={generate} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generate
          </Button>
        </CardContent>
      </Card>

      {plan?.status === 'BLOCKED' && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Fixed payroll exceeds the labor budget</AlertTitle>
          <AlertDescription>
            Fixed payroll consumes the entire labor budget — there is no PT labor
            fee to schedule against. Shortfall: {usd(plan.shortfall ?? 0)}.
            Lower fixed payroll or raise the revenue forecast, then regenerate.
          </AlertDescription>
        </Alert>
      )}

      {plan?.status === 'OVER_BUDGET' && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Over budget — baseline coverage only</AlertTitle>
          <AlertDescription>
            The PT labor fee can&apos;t cover the minimum staffing while open, so
            the baseline is scheduled anyway. Overage:{' '}
            {usd(plan.engine?.coverage.overage ?? 0)}. The manager decides what to
            cut.
          </AlertDescription>
        </Alert>
      )}

      {noHistory && (
        <Alert>
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>No sales history for this weekday</AlertTitle>
          <AlertDescription>
            Coverage was distributed using uniform weights. Refresh the heatmap or
            override the curve manually.
          </AlertDescription>
        </Alert>
      )}

      {lowConfidence && !noHistory && (
        <Alert>
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Low-confidence sales data</AlertTitle>
          <AlertDescription>
            Some hours have fewer than 3 samples in the trailing window. Treat the
            recommendation as approximate.
          </AlertDescription>
        </Alert>
      )}

      {plan?.engine && plan.status !== 'BLOCKED' && (
        <Card>
          <CardHeader>
            <CardTitle>Recommended schedule</CardTitle>
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
