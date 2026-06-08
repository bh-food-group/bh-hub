# Labor Module (`/labor`) — Part-Time Shift Scheduler

Given a revenue forecast, recommends a part-time shift schedule that fits inside
a labor budget, shaped by historical sales by hour. Ships dark behind a flag.

## Pipeline

```
Clover net sales (trailing 8 wks) ─avg by (weekday,hour)→ Sales heatmap   (Stage A)
Monthly forecast → split to days (weekday sales weight); monthly fixed
  payroll → split evenly (÷ days in month)
Daily forecast ×budget% → labor budget − daily fixed payroll → PT labor fee (Stage B)
PT fee → coverage curve (sales-weighted) → pack into shifts → table        (Stage C)
```

**Monthly inputs:** `revenue_forecasts` and `fixed_payroll` are keyed by
`year_month`. The cascade distributes them per day: revenue by the day's weekday
sales mix (`weekdayDailyAverages`), fixed payroll evenly. See
`features/labor/data/distribution.ts`.

**Holiday handling** (`features/labor/data/holidays.ts`, reuses the dashboard's
`isBcPublicHoliday`):
- Heatmap: BC statutory holidays are auto-excluded from the normal weekday
  averages (so a holiday can't skew "a typical Monday"), AND pooled into a
  separate **holiday profile** stored at `dow = HOLIDAY_DOW (7)`, built from
  holiday dates over the trailing `HOLIDAY_LOOKBACK_MONTHS` (12).
- Distribution + engine: a holiday day is weighted by the holiday profile's daily
  average (its historical tendency) and uses the holiday hourly curve — not the
  normal weekday. Falls back to the weekday when there's no holiday history.
- `ingestHolidayHistory` pulls past holiday dates (single-day Clover fetches) so
  the profile has samples; the cron and `pnpm labor:heatmap` both run it.

**Populating the heatmap locally** (Vercel cron doesn't fire in dev):
`pnpm labor:heatmap` (all Clover-ready locations) or
`pnpm labor:heatmap <locationId>`.

## Layout

- **Engine** (pure, no DB/React): `features/labor/engine/` — `computeCoverage`
  (C1), `packShifts` (C2), `buildScheduleTable` (C3), `runEngine`. Unit-tested in
  `engine.test.ts` (golden C1 case + the 7 acceptance invariants). Run `pnpm test`.
- **Data layer** (server, Prisma + Clover): `features/labor/data/` — settings,
  Clover hourly ingest, heatmap (trimmed mean), budget cascade, plan persistence,
  weekly rollup.
- **API** (app-layer auth, location-scoped): `app/api/labor/*` — `heatmap`,
  `forecast` (office, monthly), `fixed-payroll` (manager, monthly), `plan`
  (+ `plan/[id]`), `week`, `week-schedule` (7 full day plans), `month`,
  `settings`, `exclusions`. Guard: `lib/labor/api-auth.ts`.
- **UI** (English only): `app/(main)/labor/*` + `features/labor/components/*` —
  Schedule (pick a week → day tabs Sun–Sat → that day's colored table), Budget
  Planner (monthly inputs + per-weekday distribution + weekly rollup), Sales
  Heatmap, Settings tabs. Nav item in `HeaderNav`.
- **Nightly cron**: `app/api/cron/labor-heatmap` (in `vercel.json`, 13:00 UTC).

## Architecture notes (vs. the brief)

- The brief assumed Supabase + RLS. The DB is Supabase-hosted Postgres but the app
  uses **Prisma over a single pooled connection — no DB RLS**. The brief's
  row-level rules are enforced **application-side** in every route and all queries
  are scoped by `location_id` (mirrors `app/api/dashboard/revenue/route.ts`).
- Net Sales is locked to the existing `cloverPaymentNetSalesCents`
  (`amount − tax − tip`, SUCCESS payments only) — reuses the single source of
  truth; no second Clover client.
- `close_hour` is the **last operating hour bucket, inclusive**: 5 AM–10 PM →
  `open=5, close=22` (18 buckets).
- C1 golden curve sums to 30 (cost = fee); after packing, the narrow peak that
  can't fit a real-length shift is flattened, so realized coverage sums to 29
  (cost 580 ≤ 600). Pinned in `engine.test.ts`.

## Setup

The module is always on (visible to admin/office/manager — no feature flag).
Access is still role/location-scoped (see `lib/labor/api-auth.ts`).

1. **Apply migrations**: `prisma migrate deploy` (prod) / `pnpm db:migrate` (dev).
   Adds the `labor` schema + tables (`20260605170000_labor_module`,
   `20260608120000_labor_monthly_inputs`).
2. Optional: `BC_MINIMUM_WAGE` (defaults to 17.85; used only to warn, never
   hardcoded).
3. Per location, set **Settings** (wage, open/close hours, budget %, etc.).
4. The nightly cron (`/api/cron/labor-heatmap`) ingests Clover history + builds
   the heatmap; locally run `pnpm labor:heatmap`. Then generate plans.

## Out of scope (v2)

Role-aware coverage/columns and auto-assigning named staff. The `role` column on
`labor_plan_shifts` exists but is left null.
