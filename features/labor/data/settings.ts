import { prisma } from '@/lib/core';
import type { LaborEngineSettings } from '@/features/labor/engine';
import { LABOR_SETTINGS_DEFAULTS } from '@/lib/labor/constants';

/** Resolved settings for a location (DB row merged over defaults). */
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
  /** True when a `labor_settings` row exists for this location. */
  configured: boolean;
};

function dec(v: { toString(): string } | number | null | undefined): number {
  if (v == null) return Number.NaN;
  return typeof v === 'number' ? v : Number.parseFloat(v.toString());
}

/** Read settings, falling back to defaults so screens never hard-fail. */
export async function getLaborSettings(
  locationId: string,
): Promise<ResolvedLaborSettings> {
  const row = await prisma.laborSettings.findUnique({ where: { locationId } });
  if (!row) {
    return { locationId, ...LABOR_SETTINGS_DEFAULTS, configured: false };
  }
  return {
    locationId,
    budgetPct: dec(row.budgetPct),
    wage: dec(row.wage),
    minCov: row.minCov,
    maxCov: row.maxCov,
    minShiftHrs: dec(row.minShiftHrs),
    maxShiftHrs: dec(row.maxShiftHrs),
    increment: dec(row.increment),
    openHour: row.openHour,
    closeHour: row.closeHour,
    configured: true,
  };
}

/** Map resolved settings into the pure engine's settings shape. */
export function toEngineSettings(
  s: ResolvedLaborSettings,
): LaborEngineSettings {
  return {
    wage: s.wage,
    minCov: s.minCov,
    maxCov: s.maxCov,
    inc: s.increment,
    minShift: s.minShiftHrs,
    maxShift: s.maxShiftHrs,
    openHour: s.openHour,
    closeHour: s.closeHour,
  };
}
