'use client';

/**
 * Browser-side API client + JSON response types for the Labor module. Types
 * mirror the server route shapes; engine types are imported directly because the
 * engine module is pure (no DB/React) and safe to reference from the client.
 */
import type {
  CoverageResult,
  LaborEngineSettings,
  PlanStatus,
  ScheduleTable,
  Shift,
} from '@/features/labor/engine';

export type ResolvedLaborSettings = {
  locationId: string;
  budgetPct: number;
  wage: number;
  minCov: number;
  maxCov: number;
  minShiftHrs: number;
  maxShiftHrs: number;
  increment: number;
  openHour: number;
  closeHour: number;
  configured: boolean;
};

export type HeatmapCell = {
  dow: number;
  hour: number;
  avgNetSales: number;
  sampleN: number;
  lowConfidence: boolean;
};

export type HeatmapResponse = {
  locationId: string;
  openHour: number;
  closeHour: number;
  configured: boolean;
  cells: HeatmapCell[];
};

export type BudgetCascade = {
  revenueForecast: number;
  budgetPct: number;
  laborBudget: number;
  fixedPayroll: number;
  ptLaborFee: number;
  wage: number;
  affordableHrs: number;
  blocked: boolean;
  shortfall: number;
};

export type DayResponse = {
  locationId: string;
  date: string;
  forecastMissing: boolean;
  fixedPayrollMissing: boolean;
  revenueForecast: number;
  fixedPayroll: number;
  cascade: BudgetCascade;
  settings: ResolvedLaborSettings;
};

export type EnginePlan = {
  coverage: CoverageResult;
  shifts: Shift[];
  table: ScheduleTable;
  status: PlanStatus;
};

export type PlanResult = {
  date: string;
  dow: number;
  cascade: BudgetCascade;
  engine?: EnginePlan;
  sales: { s: number[]; sampleN: number[] };
  settings: LaborEngineSettings;
  status: 'DRAFT' | 'OVER_BUDGET' | 'BLOCKED';
  shortfall?: number;
  planId: string | null;
  forecastMissing: boolean;
  fixedPayrollMissing: boolean;
};

export type WeekDay = {
  date: string;
  status: PlanResult['status'];
  laborBudget: number;
  fixedPayroll: number;
  ptLaborFee: number;
  affordableHrs: number;
  scheduledHrs: number;
  scheduledCost: number;
  forecastMissing: boolean;
  fixedPayrollMissing: boolean;
};

export type WeekRollup = {
  locationId: string;
  weekStart: string;
  days: WeekDay[];
  totals: {
    laborBudget: number;
    fixedPayroll: number;
    ptLaborFee: number;
    affordableHrs: number;
    scheduledHrs: number;
    scheduledCost: number;
  };
};

export type Exclusion = {
  businessDate: string;
  reason: string | null;
  createdAt: string;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return body;
}

const q = (params: Record<string, string>) =>
  new URLSearchParams(params).toString();

export const laborApi = {
  getSettings: (location: string) =>
    fetch(`/api/labor/settings?${q({ location })}`).then(
      jsonOrThrow<{
        settings: ResolvedLaborSettings;
        bcMinimumWage: number;
        wageBelowMinimum: boolean;
      }>,
    ),

  saveSettings: (payload: {
    location: string;
    budgetPct: number;
    wage: number;
    minCov: number;
    maxCov: number;
    minShiftHrs: number;
    maxShiftHrs: number;
    increment: number;
    openHour: number;
    closeHour: number;
  }) =>
    fetch('/api/labor/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(jsonOrThrow<{ ok: true; settings: ResolvedLaborSettings }>),

  getHeatmap: (location: string) =>
    fetch(`/api/labor/heatmap?${q({ location })}`).then(
      jsonOrThrow<HeatmapResponse>,
    ),

  getDay: (location: string, date: string) =>
    fetch(`/api/labor/day?${q({ location, date })}`).then(
      jsonOrThrow<DayResponse>,
    ),

  saveForecast: (location: string, date: string, amount: number) =>
    fetch('/api/labor/forecast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ location, date, amount }),
    }).then(jsonOrThrow<{ ok: true }>),

  saveFixedPayroll: (location: string, date: string, amount: number) =>
    fetch('/api/labor/fixed-payroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ location, date, amount }),
    }).then(jsonOrThrow<{ ok: true }>),

  generatePlan: (location: string, date: string) =>
    fetch('/api/labor/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ location, date }),
    }).then(jsonOrThrow<{ locationId: string; plan: PlanResult }>),

  getWeek: (location: string, weekStart: string) =>
    fetch(`/api/labor/week?${q({ location, week_start: weekStart })}`).then(
      jsonOrThrow<WeekRollup>,
    ),

  listExclusions: (location: string) =>
    fetch(`/api/labor/exclusions?${q({ location })}`).then(
      jsonOrThrow<{ exclusions: Exclusion[] }>,
    ),

  addExclusion: (location: string, date: string, reason?: string) =>
    fetch('/api/labor/exclusions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ location, date, reason }),
    }).then(jsonOrThrow<{ ok: true }>),

  removeExclusion: (location: string, date: string) =>
    fetch(`/api/labor/exclusions?${q({ location, date })}`, {
      method: 'DELETE',
    }).then(jsonOrThrow<{ ok: true }>),
};
