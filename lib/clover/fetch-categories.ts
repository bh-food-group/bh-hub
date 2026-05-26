import { cloverFetch } from './clover-fetch';
import { getCloverApiBaseUrl } from './config';

export type CloverCategory = {
  id: string;
  name: string;
};

type CategoriesResponse = { elements?: { id?: string; name?: string }[] };
type ItemsResponse = { elements?: { id?: string }[] };

const CATEGORY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — categories change rarely
const categoryCache = new Map<string, { data: CloverCategory[]; expiresAt: number }>();

/** Returns all menu categories for the merchant. Results are cached in-process for 1 hour. */
export async function fetchCloverCategories(
  merchantId: string,
  token: string,
): Promise<CloverCategory[]> {
  const cached = categoryCache.get(merchantId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const base = getCloverApiBaseUrl();
  const url = `${base}/v3/merchants/${merchantId}/categories?limit=200`;
  const res = await cloverFetch(url, token);
  if (!res.ok) return cached?.data ?? []; // return stale on error rather than empty
  const json = (await res.json()) as CategoriesResponse;
  const data = (json.elements ?? [])
    .filter((c): c is { id: string; name: string } => !!c.id && !!c.name)
    .map((c) => ({ id: c.id, name: c.name }));
  categoryCache.set(merchantId, { data, expiresAt: Date.now() + CATEGORY_CACHE_TTL_MS });
  return data;
}

/** Returns item IDs that belong to the given category. */
export async function fetchCloverItemIdsByCategory(
  merchantId: string,
  token: string,
  categoryId: string,
): Promise<string[]> {
  const base = getCloverApiBaseUrl();
  const url = `${base}/v3/merchants/${merchantId}/categories/${categoryId}/items?limit=1000`;
  const res = await cloverFetch(url, token);
  if (!res.ok) return [];
  const json = (await res.json()) as ItemsResponse;
  return (json.elements ?? []).map((i) => i.id ?? '').filter(Boolean);
}

const SEASONAL_KEYWORDS = /special|seasonal|limited|lto|feature/i;

export function findSeasonalCategory(
  categories: CloverCategory[],
): CloverCategory | undefined {
  return categories.find((c) => SEASONAL_KEYWORDS.test(c.name));
}

const MENU_CATEGORY_KEYWORDS = /drink|food|kids|bakery/i;

/** Returns all categories whose name contains DRINK, FOOD, KIDS, or BAKERY. */
export function findMenuCategories(categories: CloverCategory[]): CloverCategory[] {
  return categories.filter((c) => MENU_CATEGORY_KEYWORDS.test(c.name));
}
