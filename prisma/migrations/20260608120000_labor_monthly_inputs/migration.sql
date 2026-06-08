-- Labor budget inputs become MONTHLY: revenue_forecasts and fixed_payroll are
-- now keyed by year_month (YYYY-MM) instead of a full date. The cascade
-- distributes the monthly figures to days (revenue by weekday sales weight,
-- fixed payroll evenly).
--
-- Rename the column in place (preserves the primary key, which simply follows
-- the renamed column), then coerce any existing full-date values to YYYY-MM.

-- revenue_forecasts: date → year_month
ALTER TABLE "labor"."revenue_forecasts" RENAME COLUMN "date" TO "year_month";
UPDATE "labor"."revenue_forecasts"
  SET "year_month" = substring("year_month" from 1 for 7)
  WHERE length("year_month") > 7;

-- fixed_payroll: date → year_month
ALTER TABLE "labor"."fixed_payroll" RENAME COLUMN "date" TO "year_month";
UPDATE "labor"."fixed_payroll"
  SET "year_month" = substring("year_month" from 1 for 7)
  WHERE length("year_month") > 7;
