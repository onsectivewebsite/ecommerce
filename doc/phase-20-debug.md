# Phase 20 — Debug Pass

Companion to `phase-20.md`. Decisions made, seams to watch, what
reviewers should test.

## 1. The invariants Phase 20 preserves

1. **Snapshotted impact.** Every `SustainabilityImpact` row stores the
   savings as immutable numbers at write time. Updating a
   `SustainabilityFactor` row affects *future* events only.
   Past rows never recompute — same pattern Phase 6 tax rows use.
2. **Idempotent recording.** `(subjectKind, subjectId)` is unique.
   A duplicate event (re-emitted webhook, double-fired listener) is
   a no-op.
3. **Sustainability never breaks primary flows.** All writes happen
   in an `@OnEvent` listener that catches its own exceptions. An
   outage of impact recording does not affect order/trade-in/repair
   completion.

## 2. Non-obvious decisions

### 2.1 Factor lookup is two-tier with optional brand override
`(categorySlug, brandId)` row beats `(categorySlug)` row. Most
categories ship with a single category-only row (`brandId = null`).
Brand-specific overrides land only where a brand's true impact
materially diverges from the category baseline. Avoids exploding into
per-brand-per-category maintenance.

### 2.2 Listener pattern, not direct service calls
The source services (Orders, TradeIn, RepairNetwork) don't import
`SustainabilityService`. The listener subscribes to their events:
- `order.paid` → walks order items, records per refurb/openbox line.
- `tradein.order.paid` → records on trade-in completion.
- `repair.ticket.completed` → records on repair completion.

This keeps sustainability as a derived read-model layer that can be
disabled or replaced without touching the lifecycle code.

### 2.3 Loose subjectId FK
`SustainabilityImpact.subjectId` is a plain String, no Prisma
relation. The source table varies by `subjectKind` (OrderItem,
TradeInOrder, ServiceTicket). We index `(subjectKind, subjectId)` for
fast lookups — same pattern Phase 16 uses for `AiInferenceRun`.

### 2.4 Brand-side aggregate is public
`/sustainability/brands/:brandId` is unauthenticated because the
brand storefront SSR fetch needs it. The data is platform-aggregate
counts and shows nothing PII. The same endpoint exists internally;
no separate admin-only variant.

### 2.5 Order-paid listener walks ALL items, not just refurb
We do one query for all items and filter inline. Slightly more
data fetched per event than a WHERE-filtered query, but the wins
are: one round-trip, simpler code, and the listener handles the
mixed case (one order with both a NEW_GENUINE and a REFURB line)
naturally — the NEW_GENUINE line just doesn't get recorded.

### 2.6 No subscription/topup noise
The order-paid listener short-circuits on order ids starting with
`sub_` or `ad_topup_` (Phase 3 subscriptions, Phase 4 ads top-ups
use synthetic ids). Matches the same filter `FulfillmentListener`
uses in Phase 13.

### 2.7 Public `/impact` page is server-rendered
We use `cache: 'no-store'` for the platform totals fetch so SEO
crawlers see live numbers without a stale cache. Future: layer an
ISR/edge cache once the platform stops being a daily-launch target.

### 2.8 No CSR export format in this phase
The spec calls out "CSR-style exports" — we ship the data API and
the rendered pages. Anyone who needs an actual PDF can take the
JSON. A real ESG-framework-aligned report is a follow-on phase
because the framework choice (GRI / SASB / TCFD) materially shapes
the schema.

## 3. Things to test end-to-end

- Admin sets factors for `phones` (kgCo2=55, kgMat=0.18, life=2)
  on `/admin/sustainability`.
- Buyer buys a REFURB_GRADE_A iPhone. Payment captures →
  `order.paid` fires → listener writes a `REFURB_PURCHASE` impact
  row with the snapshot values × qty.
- Buyer's `/account/impact` shows hero totals and the activity
  list.
- Public `/impact` shows platform totals + top-brands-90d.
- Brand storefront `/brand/apple` shows an "Impact with Apple"
  panel.
- Trade-in paid out → `TRADEIN_PAYOUT` row written.
- Repair completed → `REPAIR_COMPLETED` row written.
- Re-emit an `order.paid` for the same order → no duplicate rows
  (unique on `(subjectKind, subjectId)`).
- Admin updates `phones` factor → past rows unchanged → new event
  uses new factor.

## 4. Known limitations

- No CSR export format (see 2.8).
- No locale-aware unit conversion. Everything is kg / years.
- No facet filters on `/impact` or `/account/impact`.
- No time-series store. Trend charts would need a `seriesByMonth`
  call that does `date_trunc('month', createdAt) GROUP BY` — we
  expose the data shape but the chart UI is deferred.
- No webhooks for impact events. If brands or buyers want
  notifications, Phase 11 seller-webhooks could add a topic later.
- Factor edit is a flat form, not historical. We don't store factor
  history, but past impact rows are snapshotted, so the audit trail
  for *what was used when* is reconstructible only from the impact
  rows themselves.
- No factor seed data. Admin must populate factors before any
  events will have meaningful numbers (events with no matching
  factor record `0` savings — not an error).

## 5. Files added

- `services/api/src/modules/sustainability/{sustainability.service,sustainability.listener,sustainability.controller,sustainability.module,dto}.ts`
- `packages/api-client/src/endpoints/sustainability.ts`
- `apps/buyer-web/src/app/impact/page.tsx`
- `apps/buyer-web/src/app/account/impact/page.tsx`
- `apps/admin-web/src/app/sustainability/page.tsx`

## 6. Files edited

- `services/api/prisma/schema.prisma` — added
  `SustainabilitySubjectKind` enum + `SustainabilityFactor` +
  `SustainabilityImpact` models with relevant indexes.
- `services/api/src/app.module.ts` — registered `SustainabilityModule`.
- `packages/api-client/src/index.ts` — re-export `sustainability`.
- `apps/admin-web/src/lib/api.ts`, `apps/buyer-web/src/lib/api.ts` —
  wired `SustainabilityApi`.
- `apps/admin-web/src/components/Shell.tsx` — added Sustainability nav.
- `apps/buyer-web/src/components/TopBar.tsx` — added Impact link.
- `apps/buyer-web/src/app/brand/[slug]/page.tsx` — added brand
  storefront impact panel (server-fetched alongside the storefront).

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_20_sustainability
pnpm -r typecheck
pnpm -r build
```

The migration adds:
- New enum `SustainabilitySubjectKind`.
- New table `SustainabilityFactor` with `@@unique([categorySlug, brandId])`.
- New table `SustainabilityImpact` with `@@unique([subjectKind, subjectId])`
  and three secondary indexes.

No data backfill needed. Existing orders/trade-ins/repairs already
completed before this phase will NOT have impact rows — only new
events get recorded. If you want to backfill historical events,
write a one-off script that walks orders/trade-ins/repairs and calls
`SustainabilityService.record` for each.
