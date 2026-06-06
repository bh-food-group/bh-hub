'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { UserRole } from '@/types/user';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { laborApi, type MonthResponse, type WeekRollup } from './api';
import { hrs, usd } from './format';

type Props = {
  locationId: string;
  role: UserRole | null;
  isOfficeOrAdmin: boolean;
  date: string; // shared anchor; its month drives the inputs
  onDateChange: (date: string) => void;
};

function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - d.getDay());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function BudgetPlannerPanel({
  locationId,
  role,
  isOfficeOrAdmin,
  date,
  onDateChange,
}: Props) {
  const yearMonth = date.slice(0, 7);
  const [month, setMonth] = useState<MonthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [forecast, setForecast] = useState('');
  const [payroll, setPayroll] = useState('');
  const [savingForecast, setSavingForecast] = useState(false);
  const [savingPayroll, setSavingPayroll] = useState(false);

  const [week, setWeek] = useState<WeekRollup | null>(null);
  const [weekLoading, setWeekLoading] = useState(false);

  const canEditForecast = isOfficeOrAdmin;
  const canEditPayroll = role === 'manager' || role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await laborApi.getMonth(locationId, yearMonth);
      setMonth(res);
      setForecast(res.forecastMissing ? '' : String(res.revenueForecast));
      setPayroll(res.fixedPayrollMissing ? '' : String(res.fixedPayroll));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load month');
    } finally {
      setLoading(false);
    }
  }, [locationId, yearMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveForecast() {
    const amount = Number.parseFloat(forecast);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Enter a valid monthly forecast');
      return;
    }
    setSavingForecast(true);
    try {
      await laborApi.saveForecast(locationId, yearMonth, amount);
      toast.success('Monthly revenue forecast saved');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save forecast');
    } finally {
      setSavingForecast(false);
    }
  }

  async function savePayroll() {
    const amount = Number.parseFloat(payroll);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Enter a valid monthly fixed payroll');
      return;
    }
    setSavingPayroll(true);
    try {
      await laborApi.saveFixedPayroll(locationId, yearMonth, amount);
      toast.success('Monthly fixed payroll saved');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save payroll');
    } finally {
      setSavingPayroll(false);
    }
  }

  async function loadWeek() {
    setWeekLoading(true);
    try {
      const res = await laborApi.getWeek(locationId, weekStartOf(date));
      setWeek(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load week');
    } finally {
      setWeekLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Monthly budget inputs</CardTitle>
            <p className="text-sm text-muted-foreground">
              Entered per month; distributed to days (revenue by weekday sales
              mix, fixed payroll evenly).
            </p>
          </div>
          <Input
            type="month"
            value={yearMonth}
            onChange={(e) =>
              e.target.value && onDateChange(`${e.target.value}-01`)
            }
            className="w-40"
          />
        </CardHeader>
        <CardContent className="space-y-5">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="forecast">
                Monthly revenue forecast (office)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="forecast"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={forecast}
                  onChange={(e) => setForecast(e.target.value)}
                  disabled={!canEditForecast}
                  placeholder="0.00"
                />
                {canEditForecast && (
                  <Button onClick={saveForecast} disabled={savingForecast}>
                    {savingForecast && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Save
                  </Button>
                )}
              </div>
              {!canEditForecast && (
                <p className="text-xs text-muted-foreground">
                  Only office/admin can edit the forecast.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payroll">Monthly fixed payroll (manager)</Label>
              <div className="flex gap-2">
                <Input
                  id="payroll"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={payroll}
                  onChange={(e) => setPayroll(e.target.value)}
                  disabled={!canEditPayroll}
                  placeholder="0.00"
                />
                {canEditPayroll && (
                  <Button onClick={savePayroll} disabled={savingPayroll}>
                    {savingPayroll && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Save
                  </Button>
                )}
              </div>
              {!canEditPayroll && (
                <p className="text-xs text-muted-foreground">
                  Only a manager can edit fixed payroll.
                </p>
              )}
            </div>
          </div>

          {month && (
            <p className="text-sm text-muted-foreground">
              Daily fixed payroll: {usd(month.dailyFixedPayroll)} (monthly ÷{' '}
              days in month)
            </p>
          )}
        </CardContent>
      </Card>

      {month && (
        <Card>
          <CardHeader>
            <CardTitle>Per-weekday distribution</CardTitle>
            <p className="text-sm text-muted-foreground">
              How the monthly forecast lands on each weekday this month.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Weekday</th>
                  <th className="py-2 pr-4 text-right font-medium"># in month</th>
                  <th className="py-2 pr-4 text-right font-medium">Day forecast</th>
                  <th className="py-2 pr-4 text-right font-medium">Labor budget</th>
                  <th className="py-2 pr-4 text-right font-medium">PT fee</th>
                  <th className="py-2 text-right font-medium">Affordable hrs</th>
                </tr>
              </thead>
              <tbody>
                {month.perWeekday.map((d) => (
                  <tr key={d.dow} className="border-b last:border-0">
                    <td className="py-1.5 pr-4">{d.label}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {d.count}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {usd(d.dailyForecast)}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {usd(d.laborBudget)}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {d.blocked ? (
                        <span className="text-destructive">
                          {usd(d.ptLaborFee)}
                        </span>
                      ) : (
                        usd(d.ptLaborFee)
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {hrs(d.affordableHrs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Weekly rollup</CardTitle>
          <Button variant="outline" onClick={loadWeek} disabled={weekLoading}>
            {weekLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Load week of {weekStartOf(date)}
          </Button>
        </CardHeader>
        {week && (
          <CardContent className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 text-right font-medium">Labor budget</th>
                  <th className="py-2 pr-4 text-right font-medium">PT fee</th>
                  <th className="py-2 pr-4 text-right font-medium">Sched. hrs</th>
                  <th className="py-2 text-right font-medium">Sched. cost</th>
                </tr>
              </thead>
              <tbody>
                {week.days.map((d) => (
                  <tr key={d.date} className="border-b last:border-0">
                    <td className="py-1.5 pr-4">{d.date}</td>
                    <td className="py-1.5 pr-4 text-xs text-muted-foreground">
                      {d.status}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {usd(d.laborBudget)}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {usd(d.ptLaborFee)}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {hrs(d.scheduledHrs)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {usd(d.scheduledCost)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 font-semibold">
                  <td className="py-2 pr-4" colSpan={2}>
                    Week total
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {usd(week.totals.laborBudget)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {usd(week.totals.ptLaborFee)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {hrs(week.totals.scheduledHrs)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {usd(week.totals.scheduledCost)}
                  </td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
