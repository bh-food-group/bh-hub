/**
 * Shared types for Shopify Admin product search UIs (order, cost, inventory, …).
 * Matches `GET /api/shopify/products/search` → `{ hits[] }`.
 */

/** Shopify Admin `Product.status` (office search / catalog). */
export type ShopifyProductSearchStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED';

export type ShopifyProductSearchHit = {
  productId: string;
  productTitle: string;
  productStatus: ShopifyProductSearchStatus;
  variantId: string;
  variantTitle: string | null;
  sku: string | null;
  price: string | null;
  unitCost?: string | null;
  imageUrl?: string | null;
};
