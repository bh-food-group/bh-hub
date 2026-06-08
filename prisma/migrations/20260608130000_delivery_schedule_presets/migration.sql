-- Reusable named delivery-schedule presets (e.g. "BH Shipping").
-- A preset holds default weekly partition windows; suppliers reference it via
-- delivery_schedule.rule.presetId. Per-customer exception windows override the
-- preset default when a supplier using the preset ships to that customer.

-- CreateTable
CREATE TABLE "order"."delivery_schedule_presets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "windows" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "delivery_schedule_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order"."delivery_schedule_preset_customer_exceptions" (
    "id" TEXT NOT NULL,
    "preset_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "windows" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "delivery_schedule_preset_customer_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_schedule_presets_name_key" ON "order"."delivery_schedule_presets"("name");

-- CreateIndex
CREATE INDEX "delivery_schedule_preset_customer_exceptions_customer_id_idx" ON "order"."delivery_schedule_preset_customer_exceptions"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_schedule_preset_customer_exceptions_preset_id_cust_key" ON "order"."delivery_schedule_preset_customer_exceptions"("preset_id", "customer_id");

-- AddForeignKey
ALTER TABLE "order"."delivery_schedule_preset_customer_exceptions" ADD CONSTRAINT "delivery_schedule_preset_customer_exceptions_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "order"."delivery_schedule_presets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order"."delivery_schedule_preset_customer_exceptions" ADD CONSTRAINT "delivery_schedule_preset_customer_exceptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "order"."shopify_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
