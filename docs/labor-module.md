# Labor Module (`/labor`) — Part-Time Shift Scheduler

Given a revenue forecast, recommends a part-time shift schedule that fits inside
a labor budget, shaped by historical sales by hour. Ships dark behind a flag.

## Pipeline

```
Clover net sales (trailing 8 wks) ─avg by (weekday,hour)→ Sales heatmap   (Stage A)
Revenue forecast ×budget% → labor budget − fixed payroll → PT labor fee   (Stage B)
PT fee → coverage curve (sales-weighted) → pack into shifts → table       (Stage C)
```

## Layout

- **Engine** (pure, no DB/React): `features/labor/engine/` — `computeCoverage`
  (C1), `packShifts` (C2), `buildScheduleTable` (C3), `runEngine`. Unit-tested in
  `engine.test.ts` (golden C1 case + the 7 acceptance invariants). Run `pnpm test`.
- **Data layer** (server, Prisma + Clover): `features/labor/data/` — settings,
  Clover hourly ingest, heatmap (trimmed mean), budget cascade, plan persistence,
  weekly rollup.
- **API** (app-layer auth, location-scoped): `app/api/labor/*` — `heatmap`,
  `forecast` (office), `fixed-payroll` (manager), `plan` (+ `plan/[id]`), `week`,
  `day`, `settings`, `exclusions`. Guard: `lib/labor/api-auth.ts`.
- **UI** (English only): `app/(main)/labor/*` + `features/labor/components/*` —
  Schedule, Budget Planner, Sales Heatmap, Settings tabs. Nav item in `HeaderNav`.
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

## Enabling (the module is dark by default)

1. **Apply the migration** (not auto-applied — DB is the production pooler):
   `pnpm db:migrate` (dev) or `prisma migrate deploy` (prod). Adds the `labor`
   Postgres schema + tables (`prisma/migrations/20260605170000_labor_module`).
2. **Set the flag**: `LABOR_MODULE_ENABLED=true`. Optional: `BC_MINIMUM_WAGE`
   (defaults to 17.85; used only to warn, never hardcoded).
3. Per location, set **Settings** (wage, open/close hours, budget %, etc.).
4. The nightly cron ingests Clover history and builds the heatmap; or wait one
   night. Then generate plans per day.

## Out of scope (v2)

Role-aware coverage/columns and auto-assigning named staff. The `role` column on
`labor_plan_shifts` exists but is left null.
