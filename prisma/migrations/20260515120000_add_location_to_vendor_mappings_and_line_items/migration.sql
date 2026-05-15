-- Extend ShopifyVendorMapping to support (vendor, location) pairs.
-- A supplier can now be matched by (vendorName + shopifyLocationGid) with priority over vendorName-only fallback.

-- 1. Drop old single-column unique constraint on vendor_name
ALTER TABLE "order"."shopify_vendor_mappings"
  DROP CONSTRAINT IF EXISTS "shopify_vendor_mappings_vendor_name_key";

-- 2. Add new columns
ALTER TABLE "order"."shopify_vendor_mappings"
  ADD COLUMN IF NOT EXISTS "shopify_location_gid"  TEXT,
  ADD COLUMN IF NOT EXISTS "shopify_location_name" TEXT;

-- 3. Composite unique for (vendor_name, shopify_location_gid) — covers non-null location pairs.
--    Prisma @@unique([vendorName, shopifyLocationGid]) generates this index.
CREATE UNIQUE INDEX IF NOT EXISTS "shopify_vendor_mappings_vendor_name_shopify_location_gid_key"
  ON "order"."shopify_vendor_mappings" ("vendor_name", "shopify_location_gid");

-- 4. Partial unique for vendor_name when no location set — ensures only one default/fallback
--    mapping per vendor name (PostgreSQL treats NULLs as distinct in composite indexes).
CREATE UNIQUE INDEX IF NOT EXISTS "shopify_vendor_mappings_vendor_name_no_location_key"
  ON "order"."shopify_vendor_mappings" ("vendor_name")
  WHERE "shopify_location_gid" IS NULL;

-- 5. Add Shopify Location GID to order line items (populated from FulfillmentOrder.assignedLocation during sync).
ALTER TABLE "order"."shopify_order_line_items"
  ADD COLUMN IF NOT EXISTS "shopify_location_gid" TEXT;

CREATE INDEX IF NOT EXISTS "shopify_order_line_items_shopify_location_gid_idx"
  ON "order"."shopify_order_line_items" ("shopify_location_gid");
