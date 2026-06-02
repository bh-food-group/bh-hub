-- NOTE: Reconstructed from the live database on 2026-06-02. The original
-- migration file was applied directly to the shared DB but never committed,
-- causing local/DB migration-history drift. Contents below match the schema
-- objects actually present in the database. Idempotent guards keep it safe.

-- Office PO default-number short codes (hub-only; not synced to Shopify).
ALTER TABLE "order"."shopify_customers"
  ADD COLUMN IF NOT EXISTS "office_po_account_code" TEXT;

ALTER TABLE "order"."suppliers"
  ADD COLUMN IF NOT EXISTS "office_po_supplier_code" TEXT;
