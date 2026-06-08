'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  cloneBhSplitTemplateWindows,
  parseSupplierDeliverySchedule,
  supplierDeliveryScheduleForPreset,
  supplierDeliveryScheduleFromPartitionWindows,
  type IsoWeekWindow,
  type SupplierDeliverySchedule,
} from '@/lib/order/supplier-delivery-schedule';

export const ISO_WEEKDAY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

export type DeliveryRuleKind =
  | 'off'
  | 'next'
  | 'day_after_creation'
  | 'preset'
  | 'partition';

export function ruleKindFromSchedule(
  raw: unknown | null | undefined,
): DeliveryRuleKind {
  if (raw == null) return 'off';
  const s = parseSupplierDeliverySchedule(raw);
  if (!s) return 'off';
  if (s.rule.kind === 'day_after_creation') return 'day_after_creation';
  if (s.rule.kind === 'next_delivery_day') return 'next';
  if (s.rule.kind === 'preset') return 'preset';
  if (s.rule.kind === 'iso_week_windows') return 'partition';
  return 'off';
}

export function presetIdFromSchedule(
  raw: unknown | null | undefined,
): string | null {
  const s = parseSupplierDeliverySchedule(raw);
  return s && s.rule.kind === 'preset' ? s.rule.presetId : null;
}

export function initialPartitionWindows(
  raw: unknown | null | undefined,
): IsoWeekWindow[] {
  const s = parseSupplierDeliverySchedule(raw);
  if (!s || s.rule.kind !== 'iso_week_windows') return [];
  return s.rule.windows.map((w) => ({
    orderWeekdays: [...w.orderWeekdays],
    deliverWeekday: w.deliverWeekday,
    deliverIn: w.deliverIn,
  }));
}

export function validatePartitionWindows(
  windows: IsoWeekWindow[],
): string | null {
  if (windows.length === 0) {
    return 'Add at least one partition window, or turn off the delivery schedule.';
  }
  for (let i = 0; i < windows.length; i++) {
    if (windows[i].orderWeekdays.length === 0) {
      return `Window ${i + 1}: pick at least one “order placed on” weekday.`;
    }
  }
  const seen = new Set<number>();
  for (const w of windows) {
    for (const d of w.orderWeekdays) {
      if (seen.has(d)) {
        return `Order weekday ${d} appears in more than one window.`;
      }
      seen.add(d);
    }
  }
  return null;
}

export function weekdaysFromSchedule(
  raw: unknown | null | undefined,
): number[] {
  const s = parseSupplierDeliverySchedule(raw);
  if (!s) return [];
  return [...new Set(s.deliveryWeekdays)].sort((a, b) => a - b);
}

export function useSupplierDeliveryScheduleForm(
  initialScheduleRaw: unknown | null | undefined,
) {
  const [deliveryRuleKind, setDeliveryRuleKind] = useState<DeliveryRuleKind>(
    () => ruleKindFromSchedule(initialScheduleRaw),
  );
  const [deliveryWeekdays, setDeliveryWeekdays] = useState<number[]>(() =>
    weekdaysFromSchedule(initialScheduleRaw),
  );
  const [partitionWindows, setPartitionWindows] = useState<IsoWeekWindow[]>(
    () => initialPartitionWindows(initialScheduleRaw),
  );
  const [presetId, setPresetId] = useState<string | null>(() =>
    presetIdFromSchedule(initialScheduleRaw),
  );

  useEffect(() => {
    setDeliveryRuleKind(ruleKindFromSchedule(initialScheduleRaw));
    setDeliveryWeekdays(weekdaysFromSchedule(initialScheduleRaw));
    setPartitionWindows(initialPartitionWindows(initialScheduleRaw));
    setPresetId(presetIdFromSchedule(initialScheduleRaw));
  }, [initialScheduleRaw]);

  const buildDeliverySchedulePayload =
    useCallback((): SupplierDeliverySchedule | null => {
      if (deliveryRuleKind === 'off') return null;
      if (deliveryRuleKind === 'preset') {
        return presetId ? supplierDeliveryScheduleForPreset(presetId) : null;
      }
      if (deliveryRuleKind === 'partition') {
        return supplierDeliveryScheduleFromPartitionWindows(partitionWindows);
      }
      if (deliveryRuleKind === 'day_after_creation') {
        return {
          deliveryWeekdays: [],
          rule: { kind: 'day_after_creation' },
        };
      }
      if (deliveryWeekdays.length === 0) return null;
      return {
        deliveryWeekdays: [...new Set(deliveryWeekdays)].sort((a, b) => a - b),
        rule: { kind: 'next_delivery_day' },
      };
    }, [deliveryRuleKind, deliveryWeekdays, partitionWindows, presetId]);

  const validateScheduleForSubmit = useCallback((): string | null => {
    if (deliveryRuleKind === 'preset' && !presetId) {
      return 'Pick a preset, or turn off the delivery schedule.';
    }
    if (deliveryRuleKind === 'partition') {
      return validatePartitionWindows(partitionWindows);
    }
    if (deliveryRuleKind === 'next' && deliveryWeekdays.length === 0) {
      return 'Pick at least one delivery weekday, or turn off the delivery schedule.';
    }
    return null;
  }, [deliveryRuleKind, deliveryWeekdays.length, partitionWindows, presetId]);

  const selectOff = useCallback(() => {
    setDeliveryRuleKind('off');
    setDeliveryWeekdays([]);
    setPartitionWindows([]);
  }, []);

  const selectNext = useCallback(() => {
    setDeliveryRuleKind('next');
  }, []);

  const selectDayAfterCreation = useCallback(() => {
    setDeliveryRuleKind('day_after_creation');
    setPartitionWindows([]);
  }, []);

  const selectPreset = useCallback((id: string) => {
    setDeliveryRuleKind('preset');
    setPresetId(id || null);
  }, []);

  const selectPartition = useCallback(() => {
    setDeliveryRuleKind('partition');
    setPartitionWindows((prev) =>
      prev.length > 0 ? prev : cloneBhSplitTemplateWindows(),
    );
  }, []);

  const toggleDeliveryWeekday = useCallback((d: number) => {
    setDeliveryWeekdays((prev) =>
      prev.includes(d)
        ? prev.filter((x) => x !== d)
        : [...prev, d].sort((a, b) => a - b),
    );
  }, []);

  return {
    deliveryRuleKind,
    deliveryWeekdays,
    partitionWindows,
    setPartitionWindows,
    presetId,
    selectOff,
    selectNext,
    selectDayAfterCreation,
    selectPreset,
    selectPartition,
    toggleDeliveryWeekday,
    buildDeliverySchedulePayload,
    validateScheduleForSubmit,
  };
}

export type SupplierDeliveryScheduleForm = ReturnType<
  typeof useSupplierDeliveryScheduleForm
>;
