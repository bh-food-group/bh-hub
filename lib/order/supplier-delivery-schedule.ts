import { z } from 'zod';

/** ISO weekday: 1 = Monday … 7 = Sunday (matches `date-fns` `getISODay`). */
const isoWeekday = z.number().int().min(1).max(7);

const isoWeekWindowSchema = z.object({
  orderWeekdays: z.array(isoWeekday).min(1),
  deliverWeekday: isoWeekday,
  deliverIn: z.enum(['same_iso_week', 'next_iso_week']),
});

const supplierDeliveryScheduleBaseSchema = z.object({
  deliveryWeekdays: z.array(isoWeekday),
  rule: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('next_delivery_day') }),
    /** Expected date = Vancouver calendar day of PO creation + 1 (see `creationYmd` in compute). */
    z.object({ kind: z.literal('day_after_creation') }),
    z.object({
      kind: z.literal('iso_week_windows'),
      windows: z.array(isoWeekWindowSchema).min(1),
    }),
    /**
     * References a reusable `DeliverySchedulePreset` by id. Resolved server-side into
     * concrete `iso_week_windows` (preset default, or a per-customer exception) before
     * `computeDefaultExpectedYmd` runs — see `resolveScheduleWithPresets`.
     */
    z.object({ kind: z.literal('preset'), presetId: z.string().min(1) }),
  ]),
});

export const supplierDeliveryScheduleSchema =
  supplierDeliveryScheduleBaseSchema.superRefine((data, ctx) => {
    if (data.rule.kind !== 'iso_week_windows') return;
    const seen = new Set<number>();
    for (let wi = 0; wi < data.rule.windows.length; wi++) {
      const w = data.rule.windows[wi];
      for (const d of w.orderWeekdays) {
        if (seen.has(d)) {
          ctx.addIssue({
            code: 'custom',
            message: `Order weekday ${d} must appear in only one window`,
            path: ['rule', 'windows', wi, 'orderWeekdays'],
          });
        }
        seen.add(d);
      }
    }
  });

export type SupplierDeliverySchedule = z.infer<
  typeof supplierDeliveryScheduleSchema
>;

export type IsoWeekWindow = z.infer<typeof isoWeekWindowSchema>;

/**
 * Default “BH-style” two-window template (Fri–Mon → this week Fri; Tue–Thu → next week Tue).
 * Stored per-supplier in DB as part of `delivery_schedule` — edit in UI; change template here
 * only affects new “Apply template” clicks, not existing rows.
 */
export const BH_SPLIT_TEMPLATE_WINDOWS: IsoWeekWindow[] = [
  {
    orderWeekdays: [5, 6, 7, 1],
    deliverWeekday: 5,
    deliverIn: 'same_iso_week',
  },
  {
    orderWeekdays: [2, 3, 4],
    deliverWeekday: 2,
    deliverIn: 'next_iso_week',
  },
];

export function cloneBhSplitTemplateWindows(): IsoWeekWindow[] {
  return BH_SPLIT_TEMPLATE_WINDOWS.map((w) => ({
    orderWeekdays: [...w.orderWeekdays],
    deliverWeekday: w.deliverWeekday,
    deliverIn: w.deliverIn,
  }));
}

/** `deliveryWeekdays` = unique `deliverWeekday` values from windows (sorted). */
export function supplierDeliveryScheduleFromPartitionWindows(
  windows: IsoWeekWindow[],
): SupplierDeliverySchedule {
  const normalized = windows.map((w) => ({
    orderWeekdays: [...new Set(w.orderWeekdays)].sort((a, b) => a - b),
    deliverWeekday: w.deliverWeekday,
    deliverIn: w.deliverIn,
  }));
  const deliveryWeekdays = [
    ...new Set(normalized.map((w) => w.deliverWeekday)),
  ].sort((a, b) => a - b);
  return {
    deliveryWeekdays,
    rule: { kind: 'iso_week_windows', windows: normalized },
  };
}

export function parseSupplierDeliverySchedule(
  raw: unknown,
): SupplierDeliverySchedule | null {
  const r = supplierDeliveryScheduleSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** A supplier schedule that delegates to a named `DeliverySchedulePreset`. */
export function supplierDeliveryScheduleForPreset(
  presetId: string,
): SupplierDeliverySchedule {
  return { deliveryWeekdays: [], rule: { kind: 'preset', presetId } };
}

/**
 * Validates a bare `IsoWeekWindow[]` (preset default / exception windows), enforcing the
 * same "an order weekday lives in only one window" rule as `iso_week_windows`.
 */
export const isoWeekWindowsArraySchema = z
  .array(isoWeekWindowSchema)
  .min(1)
  .superRefine((windows, ctx) => {
    const seen = new Set<number>();
    for (let wi = 0; wi < windows.length; wi++) {
      for (const d of windows[wi].orderWeekdays) {
        if (seen.has(d)) {
          ctx.addIssue({
            code: 'custom',
            message: `Order weekday ${d} must appear in only one window`,
            path: [wi, 'orderWeekdays'],
          });
        }
        seen.add(d);
      }
    }
  });

export function parseIsoWeekWindows(raw: unknown): IsoWeekWindow[] | null {
  const r = isoWeekWindowsArraySchema.safeParse(raw);
  return r.success ? r.data : null;
}
