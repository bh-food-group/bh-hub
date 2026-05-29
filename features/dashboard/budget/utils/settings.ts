import { prisma } from '@/lib/core/prisma';

const DEFAULT_BUDGET_RATE = 0.3;
export const DEFAULT_REFERENCE_PERIOD_MONTHS = 6;

const _g = globalThis as unknown as {
  _budgetSettingsCache?: { value: Awaited<ReturnType<typeof prisma.budgetSettings.findFirst>>; expiresAt: number } | null;
};
const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — changes very rarely

/** Get or create the single BudgetSettings row (default rate 33%, reference 6 months). */
export async function getOrCreateBudgetSettings() {
  const now = Date.now();
  if (_g._budgetSettingsCache && _g._budgetSettingsCache.expiresAt > now) {
    return _g._budgetSettingsCache.value!;
  }

  let settings = await prisma.budgetSettings.findFirst();
  if (!settings) {
    settings = await prisma.budgetSettings.create({
      data: {
        budgetRate: DEFAULT_BUDGET_RATE,
        referencePeriodMonths: DEFAULT_REFERENCE_PERIOD_MONTHS,
      },
    });
  }

  _g._budgetSettingsCache = { value: settings, expiresAt: now + SETTINGS_CACHE_TTL_MS };
  return settings;
}

export function invalidateBudgetSettingsCache() {
  _g._budgetSettingsCache = null;
}
