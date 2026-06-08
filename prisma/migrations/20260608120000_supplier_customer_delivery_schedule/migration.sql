-- Per-customer override of a supplier's default delivery schedule.
-- Same JSON shape as suppliers.delivery_schedule (see supplier-delivery-schedule zod).
-- Used in the order inbox to compute a PO's default expected delivery date for a
-- specific (customer, supplier) pair, falling back to the supplier default when absent.

-- CreateTable
CREATE TABLE "order"."supplier_customer_delivery_schedules" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "schedule" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "supplier_customer_delivery_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_customer_delivery_schedules_customer_id_idx" ON "order"."supplier_customer_delivery_schedules"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_customer_delivery_schedules_supplier_id_customer_i_key" ON "order"."supplier_customer_delivery_schedules"("supplier_id", "customer_id");

-- AddForeignKey
ALTER TABLE "order"."supplier_customer_delivery_schedules" ADD CONSTRAINT "supplier_customer_delivery_schedules_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "order"."suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order"."supplier_customer_delivery_schedules" ADD CONSTRAINT "supplier_customer_delivery_schedules_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "order"."shopify_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
