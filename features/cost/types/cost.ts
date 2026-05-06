// ─── List types (used by CostTable) ──────────────────────────────────────────

export interface CostPrice {
  id: string;
  title: string;
  margin: number;
  price: number;
  base: string | null;
  isFinalPrice: boolean;
  rank: string;
}

export interface CostTag {
  id: string;
  name: string;
  color: string;
}

export interface CostListItem {
  id: string;
  title: string;
  locked: boolean;
  tags: CostTag[];
  prices: CostPrice[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface CostsApiResponse {
  costs: CostListItem[];
}

// ─── Detail / Editor API types ────────────────────────────────────────────────

export interface IngredientApiItem {
  id: string;
  title: string;
  unit: string;
  amount: number;
  costId: string;
  variantId: string;
  type: string;
  image: { src: string; alt: string } | null;
  rank: string;
  // Shopify-enhanced (may be null if Shopify unavailable)
  unitPrice: number | null;
  amountPrice: number | null;
  gPrice: number | null;
  metadata?: Record<string, unknown>;
}

export type PackagingApiItem = IngredientApiItem;

export interface LaborApiItem {
  id: string;
  title: string;
  time: number;
  people: number;
  wage: number;
  costId: string;
  rank: string;
}

export interface OtherApiItem {
  id: string;
  title: string;
  amount: number;
  costId: string;
  rank: string;
}

export interface PriceApiItem {
  id: string;
  title: string;
  margin: number;
  price: number;
  base: string | null;
  isFinalPrice: boolean;
  rank: string;
  costId: string;
}

export interface CostMemoApiItem {
  id: string;
  memo: string;
  rank: string;
  userId: string;
  user: { name: string | null; email: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CostDetailApiResponse {
  id: string;
  title: string;
  totalCount: number;
  lossAmount: number | null;
  finalWeight: number | null;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  ingredients: IngredientApiItem[];
  packagings: PackagingApiItem[];
  labors: LaborApiItem[];
  others: OtherApiItem[];
  prices: PriceApiItem[];
  costMemos: CostMemoApiItem[];
  tags: CostTag[];
}

// ─── Editor state types ───────────────────────────────────────────────────────

export interface IngredientEditorItem extends IngredientApiItem {
  /** true immediately after addIngredient() — drives auto-open of select dialog */
  isNew: boolean;
}

export type PackagingEditorItem = IngredientEditorItem;

export interface LaborEditorItem extends LaborApiItem {
  isNew: boolean;
}

export interface OtherEditorItem extends OtherApiItem {
  isNew: boolean;
}

export interface PriceEditorItem extends PriceApiItem {}

export interface CostEditorState {
  id: string | undefined;
  title: string;
  totalCount: number;
  lossAmount: number | null;
  finalWeight: number | null;
  locked: boolean;
  ingredients: IngredientEditorItem[];
  packagings: PackagingEditorItem[];
  labors: LaborEditorItem[];
  others: OtherEditorItem[];
  prices: PriceEditorItem[];
  tags: CostTag[];
}

// ─── Save payload (POST/PUT body) ─────────────────────────────────────────────

export interface IngredientSaveItem {
  id: string;
  title: string;
  unit: string;
  amount: number;
  variantId: string;
  type: string;
  image: { src: string; alt: string } | null;
  rank: string;
}

export type PackagingSaveItem = IngredientSaveItem;

export interface LaborSaveItem {
  id: string;
  title: string;
  time: number;
  people: number;
  wage: number;
  rank: string;
}

export interface OtherSaveItem {
  id: string;
  title: string;
  amount: number;
  rank: string;
}

export interface PriceSaveItem {
  id: string;
  title: string;
  margin: number;
  price: number;
  base: string | null;
  isFinalPrice: boolean;
  rank: string;
}

export interface CostSavePayload {
  title: string;
  totalCount: number;
  lossAmount: number | null;
  finalWeight: number | null;
  locked: boolean;
  ingredients: IngredientSaveItem[];
  packagings: PackagingSaveItem[];
  labors: LaborSaveItem[];
  others: OtherSaveItem[];
  prices: PriceSaveItem[];
  tagIds: string[];
}
