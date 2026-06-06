'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  laborApi,
  type Exclusion,
  type HeatmapResponse,
} from './api';
import { heatStyle, hourLabel, usd, WEEKDAY_LABELS } from './format';

type Props = { locationId: string };

export function HeatmapPanel({ locationId }: Props) {
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [exDate, setExDate] = useState('');
  const [exReason, setExReason] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [heat, ex] = await Promise.all([
        laborApi.getHeatmap(locationId),
        laborApi.listExclusions(locationId),
      ]);
      setData(heat);
      setExclusions(ex.exclusions);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load heatmap');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addExclusion() {
    if (!exDate) {
      toast.error('Pick a date to exclude');
      return;
    }
    setAdding(true);
    try {
      await laborApi.addExclusion(locationId, exDate, exReason || undefined);
      toast.success('Date excluded. Refresh the heatmap to apply.');
      setExDate('');
      setExReason('');
      const ex = await laborApi.listExclusions(locationId);
      setExclusions(ex.exclusions);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add exclusion');
    } finally {
      setAdding(false);
    }
  }

  async function removeExclusion(date: string) {
    try {
      await laborApi.removeExclusion(locationId, date);
      setExclusions((prev) => prev.filter((e) => e.businessDate !== date));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading heatmap…
      </div>
    );
  }

  const cells = data?.cells ?? [];
  const hoursSet = Array.from(new Set(cells.map((c) => c.hour))).sort(
    (a, b) => a - b,
  );
  const max = cells.reduce((m, c) => Math.max(m, c.avgNetSales), 0);
  const cellAt = (dow: number, hour: number) =>
    cells.find((c) => c.dow === dow && c.hour === hour);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Average net sales by weekday & hour</CardTitle>
          <p className="text-sm text-muted-foreground">
            Trailing 8 weeks, trimmed mean. Cells with fewer than 3 samples are
            flagged. Refreshed nightly.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {cells.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No heatmap data yet. The nightly job populates this once Clover
              history is ingested.
            </p>
          ) : (
            <table className="border-collapse text-center text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left font-medium">Hour</th>
                  {WEEKDAY_LABELS.map((w) => (
                    <th key={w} className="min-w-16 px-2 py-1 font-medium">
                      {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hoursSet.map((hour) => (
                  <tr key={hour} className="border-t">
                    <td className="px-2 py-1 text-left text-muted-foreground">
                      {hourLabel(hour)}
                    </td>
                    {WEEKDAY_LABELS.map((_, dow) => {
                      const c = cellAt(dow, hour);
                      return (
                        <td
                          key={dow}
                          className={cn(
                            'border-l px-2 py-1 tabular-nums',
                            c?.lowConfidence && 'ring-1 ring-inset ring-amber-400',
                          )}
                          style={heatStyle(c?.avgNetSales ?? 0, max)}
                          title={
                            c
                              ? `${usd(c.avgNetSales)} · n=${c.sampleN}`
                              : 'no data'
                          }
                        >
                          {c ? Math.round(c.avgNetSales) : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Excluded sample dates</CardTitle>
          <p className="text-sm text-muted-foreground">
            Holidays, closures, and events to drop from the trailing sample.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ex-date">Date</Label>
              <Input
                id="ex-date"
                type="date"
                value={exDate}
                onChange={(e) => setExDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ex-reason">Reason (optional)</Label>
              <Input
                id="ex-reason"
                value={exReason}
                onChange={(e) => setExReason(e.target.value)}
                placeholder="e.g. Statutory holiday"
                className="w-64"
              />
            </div>
            <Button onClick={addExclusion} disabled={adding}>
              {adding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Exclude date
            </Button>
          </div>

          {exclusions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exclusions.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {exclusions.map((e) => (
                <li
                  key={e.businessDate}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{e.businessDate}</span>
                    {e.reason && (
                      <span className="ml-2 text-muted-foreground">
                        {e.reason}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeExclusion(e.businessDate)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${e.businessDate}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
