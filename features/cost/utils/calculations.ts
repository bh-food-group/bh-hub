import type {
  IngredientEditorItem,
  LaborEditorItem,
  OtherEditorItem,
  PriceEditorItem,
} from '../types/cost';

export const UNIT_PRICE_KEY = 'unitPrice';

/** Computes the live cost for one ingredient/packaging row from its current state.
 *
 * When gPrice ($/g) is set, amount is always treated as grams regardless of unit.
 * This covers both non-pc items and pc items where g_per_pc is known.
 * When gPrice is absent (pc without g_per_pc), falls back to unitPrice × count.
 */
export function computeItemCost(i: IngredientEditorItem): number | null {
  const { amount, unitPrice, gPrice } = i;

  // gPrice available → amount is in grams
  if (gPrice != null) return gPrice * amount;

  // No gPrice (pc without g_per_pc, or Shopify not linked): count × price per unit
  if (unitPrice == null) return null;
  return unitPrice * amount;
}

export function calcIngredientTotal(items: IngredientEditorItem[]): number {
  return items.reduce((sum, i) => {
    const cost = computeItemCost(i);
    return cost != null ? sum + cost : sum;
  }, 0);
}

export function calcPackagingTotal(items: IngredientEditorItem[]): number {
  return calcIngredientTotal(items);
}

export function calcLaborTotal(items: LaborEditorItem[]): number {
  return items.reduce((sum, l) => sum + l.time * l.people * l.wage, 0);
}

export function calcOtherTotal(items: OtherEditorItem[]): number {
  return items.reduce((sum, o) => sum + o.amount, 0);
}

export function calcTotalCost(
  ingredientTotal: number,
  packagingTotal: number,
  laborTotal: number,
  otherTotal: number,
): number {
  return ingredientTotal + packagingTotal + laborTotal + otherTotal;
}

export function calcPricePerProduct(totalCost: number, totalCount: number): number {
  if (totalCount <= 0) return 0;
  return totalCost / totalCount;
}

/** Resolves the base price a margin is applied against (unit price or another price row). */
function resolveBase(
  item: PriceEditorItem,
  pricePerProduct: number,
  allPrices: PriceEditorItem[],
): number {
  if (!item.base || item.base === UNIT_PRICE_KEY) {
    return pricePerProduct;
  }
  const refPrice = allPrices.find((p) => p.id === item.base);
  return refPrice ? refPrice.price : pricePerProduct;
}

export function calcPriceValue(
  item: PriceEditorItem,
  pricePerProduct: number,
  allPrices: PriceEditorItem[],
): number {
  return resolveBase(item, pricePerProduct, allPrices) * (1 + item.margin / 100);
}

/** Inverse of calcPriceValue: derives the margin (%) that yields the given price. */
export function calcMarginValue(
  item: PriceEditorItem,
  pricePerProduct: number,
  allPrices: PriceEditorItem[],
  targetPrice: number,
): number {
  const base = resolveBase(item, pricePerProduct, allPrices);
  if (base === 0) return 0;
  return (targetPrice / base - 1) * 100;
}

/** Recalculates all price values given the current pricePerProduct */
export function recalcPrices(
  prices: PriceEditorItem[],
  pricePerProduct: number,
): PriceEditorItem[] {
  const updated = prices.map((p) => ({ ...p }));
  // Single pass — assumes prices are ordered so base prices come before dependents
  for (const p of updated) {
    p.price = calcPriceValue(p, pricePerProduct, updated);
  }
  return updated;
}
