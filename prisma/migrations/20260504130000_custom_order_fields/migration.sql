-- Add custom order fields to shopify_orders
-- Custom orders are internally-created records for missing/damaged items (not synced from Shopify)

ALTER TABLE "order"."shopify_orders"
  ADD COLUMN "is_custom_order" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "reference_order_names" TEXT,
  ADD COLUMN "source_purchase_order_id" TEXT;

CREATE INDEX "shopify_orders_is_custom_order_idx" ON "order"."shopify_orders"("is_custom_order");
