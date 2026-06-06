/** Presentational helpers for the Labor UI. English only. */

/** 0→"12 AM", 5→"5 AM", 13→"1 PM", 22→"10 PM". */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const period = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${period}`;
}

/** "5 AM–10 PM" style range for a shift [start, end). */
export function shiftRangeLabel(startHour: number, endHour: number): string {
  return `${hourLabel(startHour)}–${hourLabel(endHour)}`;
}

export const WEEKDAY_LABELS = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

export function usd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

export function hrs(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${Number.isInteger(v) ? v : v.toFixed(1)} h`;
}

/**
 * Background color for a heat cell, scaled light→red by value/max.
 * Returns an inline style background (rgba) so it works without extra config.
 */
export function heatStyle(value: number, max: number): React.CSSProperties {
  if (max <= 0 || value <= 0) return {};
  const t = Math.min(1, value / max);
  // Light amber → deep red.
  const r = Math.round(255);
  const g = Math.round(237 - 180 * t);
  const b = Math.round(213 - 200 * t);
  return { backgroundColor: `rgb(${r}, ${g}, ${b})` };
}
