-- Drop the old single-column unique index on vendor_name.
-- It was created by Prisma as a unique index (not a constraint),
-- so DROP CONSTRAINT didn't remove it. The new partial unique index
-- (vendor_name WHERE shopify_location_gid IS NULL) replaces this.
DROP INDEX IF EXISTS "order"."shopify_vendor_mappings_vendor_name_key";
