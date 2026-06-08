-- Labor module (/labor): part-time shift scheduler.
-- New `labor` Postgres schema + tables. Row-scoped by location_id; access is
-- enforced application-side in app/api/labor/* (no DB RLS in this stack).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "labor";

-- CreateTable
CREATE TABLE "labor"."labor_settings" (
    "location_id" TEXT NOT NULL,
    "budget_pct" DECIMAL(5,4) NOT NULL DEFAULT 0.25,
    "wage" DECIMAL(10,2) NOT NULL,
    "min_cov" INTEGER NOT NULL DEFAULT 1,
    "max_cov" INTEGER NOT NULL DEFAULT 6,
    "min_shift_hrs" DECIMAL(4,2) NOT NULL DEFAULT 3,
    "max_shift_hrs" DECIMAL(4,2) NOT NULL DEFAULT 6,
    "increment" DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    "open_hour" INTEGER NOT NULL,
    "close_hour" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "labor_settings_pkey" PRIMARY KEY ("location_id")
);

-- CreateTable
CREATE TABLE "labor"."clover_sales_hourly" (
    "location_id" TEXT NOT NULL,
    "business_date" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "net_sales" DECIMAL(14,2) NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clover_sales_hourly_pkey" PRIMARY KEY ("location_id", "business_date", "hour")
);

-- CreateIndex
CREATE INDEX "clover_sales_hourly_location_id_business_date_idx" ON "labor"."clover_sales_hourly"("location_id", "business_date");

-- CreateTable
CREATE TABLE "labor"."sales_heatmap_cache" (
    "location_id" TEXT NOT NULL,
    "dow" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "avg_net_sales" DECIMAL(14,2) NOT NULL,
    "sample_n" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sales_heatmap_cache_pkey" PRIMARY KEY ("location_id", "dow", "hour")
);

-- CreateTable
CREATE TABLE "labor"."sales_sample_exclusions" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "business_date" TEXT NOT NULL,
    "reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_sample_exclusions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_sample_exclusions_location_id_business_date_key" ON "labor"."sales_sample_exclusions"("location_id", "business_date");

-- CreateTable
CREATE TABLE "labor"."revenue_forecasts" (
    "location_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_by" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "revenue_forecasts_pkey" PRIMARY KEY ("location_id", "date")
);

-- CreateTable
CREATE TABLE "labor"."fixed_payroll" (
    "location_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_by" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fixed_payroll_pkey" PRIMARY KEY ("location_id", "date")
);

-- CreateTable
CREATE TABLE "labor"."labor_plans" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "labor_budget" DECIMAL(14,2) NOT NULL,
    "fixed_payroll" DECIMAL(14,2) NOT NULL,
    "pt_labor_fee" DECIMAL(14,2) NOT NULL,
    "wage_used" DECIMAL(10,2) NOT NULL,
    "affordable_hrs" DECIMAL(8,2) NOT NULL,
    "scheduled_hrs" DECIMAL(8,2) NOT NULL,
    "scheduled_cost" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "labor_plans_location_id_date_idx" ON "labor"."labor_plans"("location_id", "date");

-- CreateTable
CREATE TABLE "labor"."labor_plan_shifts" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "shift_index" INTEGER NOT NULL,
    "start_hour" INTEGER NOT NULL,
    "end_hour" INTEGER NOT NULL,
    "role" TEXT,

    CONSTRAINT "labor_plan_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "labor_plan_shifts_plan_id_shift_index_key" ON "labor"."labor_plan_shifts"("plan_id", "shift_index");

-- CreateTable
CREATE TABLE "labor"."labor_plan_coverage" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "target_headcount" DECIMAL(5,2) NOT NULL,
    "sales_weight" DECIMAL(8,6) NOT NULL,
    "sales_avg" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "labor_plan_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "labor_plan_coverage_plan_id_hour_key" ON "labor"."labor_plan_coverage"("plan_id", "hour");

-- AddForeignKey
ALTER TABLE "labor"."labor_settings" ADD CONSTRAINT "labor_settings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor"."clover_sales_hourly" ADD CONSTRAINT "clover_sales_hourly_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor"."sales_heatmap_cache" ADD CONSTRAINT "sales_heatmap_cache_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor"."sales_sample_exclusions" ADD CONSTRAINT "sales_sample_exclusions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor"."revenue_forecasts" ADD CONSTRAINT "revenue_forecasts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor"."fixed_payroll" ADD CONSTRAINT "fixed_payroll_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor"."labor_plans" ADD CONSTRAINT "labor_plans_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor"."labor_plan_shifts" ADD CONSTRAINT "labor_plan_shifts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "labor"."labor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor"."labor_plan_coverage" ADD CONSTRAINT "labor_plan_coverage_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "labor"."labor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
