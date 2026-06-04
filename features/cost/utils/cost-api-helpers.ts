import { v4 as uuidv4 } from 'uuid';
import type {
  CostEditorState,
  CostSavePayload,
  IngredientEditorItem,
  LaborEditorItem,
  OtherEditorItem,
  PriceEditorItem,
  CostDetailApiResponse,
} from '../types/cost';

export function buildSavePayload(state: CostEditorState): CostSavePayload {
  return {
    title: state.title,
    totalCount: state.totalCount,
    lossAmount: state.lossAmount,
    finalWeight: state.finalWeight,
    locked: state.locked,
    tagIds: state.tags.map((t) => t.id),
    ingredients: state.ingredients.map(serializeIngredient),
    packagings: state.packagings.map(serializeIngredient),
    labors: state.labors.map(serializeLabor),
    others: state.others.map(serializeOther),
    prices: state.prices.map(serializePrice),
  };
}

/**
 * Returns a copy of `state` ready to be POSTed as a brand-new cost: clears the
 * cost id and regenerates every child row id (ingredients / packagings / labors /
 * others / prices) so the create does not collide with the source rows' primary
 * keys. Chained-price `base` references are remapped to the new price ids so the
 * pricing chain is preserved. Tags are kept (shared via relation, not duplicated).
 */
export function remapStateForDuplicate(state: CostEditorState): CostEditorState {
  const priceIdMap = new Map<string, string>();
  for (const p of state.prices) priceIdMap.set(p.id, uuidv4());

  return {
    ...state,
    id: undefined,
    ingredients: state.ingredients.map((i) => ({ ...i, id: uuidv4() })),
    packagings: state.packagings.map((p) => ({ ...p, id: uuidv4() })),
    labors: state.labors.map((l) => ({ ...l, id: uuidv4() })),
    others: state.others.map((o) => ({ ...o, id: uuidv4() })),
    prices: state.prices.map((p) => ({
      ...p,
      id: priceIdMap.get(p.id)!,
      base: p.base ? (priceIdMap.get(p.base) ?? p.base) : p.base,
    })),
  };
}

function serializeIngredient(i: IngredientEditorItem) {
  return {
    id: i.id,
    title: i.title,
    unit: i.unit,
    amount: i.amount,
    variantId: i.variantId,
    type: i.type,
    image: i.image,
    rank: i.rank,
  };
}

function serializeLabor(l: LaborEditorItem) {
  return { id: l.id, title: l.title, time: l.time, people: l.people, wage: l.wage, rank: l.rank };
}

function serializeOther(o: OtherEditorItem) {
  return { id: o.id, title: o.title, amount: o.amount, rank: o.rank };
}

function serializePrice(p: PriceEditorItem) {
  return { id: p.id, title: p.title, margin: p.margin, price: p.price, base: p.base, isFinalPrice: p.isFinalPrice, rank: p.rank };
}

export function deserializeCost(api: CostDetailApiResponse): CostEditorState {
  return {
    id: api.id,
    title: api.title,
    totalCount: api.totalCount,
    lossAmount: api.lossAmount,
    finalWeight: api.finalWeight,
    locked: api.locked,
    tags: api.tags,
    ingredients: api.ingredients.map((i) => ({ ...i, isNew: false })),
    packagings: api.packagings.map((p) => ({ ...p, isNew: false })),
    labors: api.labors.map((l) => ({ ...l, isNew: false })),
    others: api.others.map((o) => ({ ...o, isNew: false })),
    prices: api.prices,
  };
}

export function defaultCostState(): CostEditorState {
  return {
    id: undefined,
    title: '',
    totalCount: 1,
    lossAmount: null,
    finalWeight: null,
    locked: false,
    ingredients: [],
    packagings: [],
    labors: [],
    others: [],
    prices: [],
    tags: [],
  };
}
