-- NOTE: Reconstructed from the live database on 2026-06-02. The original
-- migration file was applied directly to the shared DB but never committed,
-- causing local/DB migration-history drift. Contents below match the schema
-- objects actually present in the database. Idempotent guards keep it safe.

-- Hub-managed many-to-many between purchase orders and Shopify orders.
-- A hub PO may aggregate multiple Shopify orders; this link exists only in the
-- hub (not represented in Shopify). Implicit Prisma relation join table.
CREATE TABLE IF NOT EXISTS "order"."_PurchaseOrderToShopifyOrder" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,

  CONSTRAINT "_PurchaseOrderToShopifyOrder_AB_pkey" PRIMARY KEY ("A", "B"),
  CONSTRAINT "_PurchaseOrderToShopifyOrder_A_fkey"
    FOREIGN KEY ("A") REFERENCES "order"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_PurchaseOrderToShopifyOrder_B_fkey"
    FOREIGN KEY ("B") REFERENCES "order"."shopify_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "_PurchaseOrderToShopifyOrder_B_index"
  ON "order"."_PurchaseOrderToShopifyOrder"("B");
