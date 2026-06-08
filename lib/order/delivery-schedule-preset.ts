import {
  parseIsoWeekWindows,
  supplierDeliveryScheduleFromPartitionWindows,
  type IsoWeekWindow,
  type SupplierDeliverySchedule,
} from './supplier-delivery-schedule';

/** Minimal preset data needed to resolve a `preset`-kind schedule into concrete windows. */
export type PresetWindowsLookup = {
  /** presetId → preset default windows. */
  defaultWindowsByPresetId: Map<string, IsoWeekWindow[]>;
  /** `${presetId}::${customerId}` → exception windows. */
  exceptionWindowsByKey: Map<string, IsoWeekWindow[]>;
};

export function buildPresetWindowsLookup(
  presets: { id: string; windows: unknown }[],
  exceptions: { presetId: string; customerId: string; windows: unknown }[],
): PresetWindowsLookup {
  const defaultWindowsByPresetId = new Map<string, IsoWeekWindow[]>();
  for (const p of presets) {
    const w = parseIsoWeekWindows(p.windows);
    if (w) defaultWindowsByPresetId.set(p.id, w);
  }
  const exceptionWindowsByKey = new Map<string, IsoWeekWindow[]>();
  for (const e of exceptions) {
    const w = parseIsoWeekWindows(e.windows);
    if (w) exceptionWindowsByKey.set(`${e.presetId}::${e.customerId}`, w);
  }
  return { defaultWindowsByPresetId, exceptionWindowsByKey };
}

/**
 * Resolves a (possibly `preset`-kind) schedule into a concrete schedule the date
 * computation understands. Non-preset schedules pass through unchanged. A preset
 * resolves to its per-customer exception windows when present, else its default
 * windows; an unknown/empty preset resolves to `null` (no schedule → creation day).
 */
export function resolveScheduleWithPresets(
  schedule: SupplierDeliverySchedule | null,
  customerId: string,
  lookup: PresetWindowsLookup,
): SupplierDeliverySchedule | null {
  if (!schedule) return null;
  if (schedule.rule.kind !== 'preset') return schedule;
  const { presetId } = schedule.rule;
  const windows =
    lookup.exceptionWindowsByKey.get(`${presetId}::${customerId}`) ??
    lookup.defaultWindowsByPresetId.get(presetId);
  if (!windows || windows.length === 0) return null;
  return supplierDeliveryScheduleFromPartitionWindows(windows);
}
