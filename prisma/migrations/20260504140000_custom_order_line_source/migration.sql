ALTER TABLE "order"."shopify_order_line_items"
  ADD COLUMN "source_purchase_order_line_item_id" TEXT;

CREATE INDEX "shopify_order_line_items_source_po_line_item_id_idx"
  ON "order"."shopify_order_line_items"("source_purchase_order_line_item_id");
