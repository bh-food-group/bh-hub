import type { LaborEngineSettings } from './types';

/**
 * The contiguous, inclusive list of operating hour buckets.
 * "5 AM to 10 PM" → openHour=5, closeHour=22 → [5..22] (18 buckets).
 */
export function operatingHours(settings: {
  openHour: number;
  closeHour: number;
}): number[] {
  const { openHour, closeHour } = settings;
  if (closeHour < openHour) return [];
  const out: number[] = [];
  for (let h = openHour; h <= closeHour; h++) out.push(h);
  return out;
}

export function operatingHourCount(settings: LaborEngineSettings): number {
  return Math.max(0, settings.closeHour - settings.openHour + 1);
}
