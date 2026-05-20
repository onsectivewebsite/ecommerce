# Phase 20 — Sustainability & Trade Reporting

Date opened: 2026-05-18
Predecessor: Phase 19 (Repair Network & Service Tickets)

## 1. Why this phase

Onsective's whole positioning since Phase 14 has been certified-only
retail with a heavy lean into refurbished and trade-in supply.
Phases 15, 18, and 19 added trade-in, outlet relisting, and repair —
each one is a *circular* event: a unit that would otherwise have
been replaced by new manufacturing instead got another life.

Phase 20 makes that visible. Every circular event records a
`SustainabilityImpact` row with snapshotted savings (kg CO₂ avoided,
kg material diverted, life-extension years). Buyers see their
lifetime impact on `/account/impact`. The platform shows aggregate
totals on a public `/impact` page that doubles as marketing. Brand
storefronts gain a small "Impact with this brand" panel.

The numbers are estimates — there is no scientific certification in
this phase. The factor table is admin-editable so we can update as
better data sources land.

## 2. Scope (in)

### 2.1 SustainabilityFactor
Per-category baselines, with optional brand override:
```
{ id, categorySlug, brandId?, kgCo2PerRefurb, kgMaterialPerRefurb,
  lifeExtensionYears, notes, createdAt, updatedAt }
```
- Admin manages from `/admin/sustainability`.
- Lookup priority: (categorySlug, brandId) match → (categorySlug) match → null.

### 2.2 SustainabilityImpact event log
One row per circular event. Snapshotted so retroactive factor
changes don't rewrite history.
```
{ id, subjectKind, subjectId, buyerUserId?, sellerId?, brandId?,
  categorySlug, kgCo2Saved, kgMaterialDiverted, lifeExtensionYears,
  reason, createdAt }
```
`subjectKind` enum: `REFURB_PURCHASE | OPENBOX_PURCHASE |
TRADEIN_PAYOUT | REPAIR_COMPLETED`.

### 2.3 Event hooks
- `order.paid` — for each order item whose product is REFURB_GRADE_* or
  OPEN_BOX, write a `REFURB_PURCHASE` or `OPENBOX_PURCHASE` impact row.
- `tradein.order.paid` (Phase 15) — write a `TRADEIN_PAYOUT` impact row.
- `repair.ticket.completed` (Phase 19) — write a `REPAIR_COMPLETED`
  impact row for the linked warranty claim's product.

### 2.4 Aggregate queries
- `buyerLifetime(userId)` — totals + a list of recent impact rows.
- `brandTotals(brandId)` — totals across all buyers for that brand.
- `platformTotals()` — totals across everything.
- `seriesByMonth(scope)` — month-over-month trend for charts (simple
  GROUP BY date_trunc — no time-series tables).

### 2.5 Buyer page `/account/impact`
- Hero card: total CO₂ saved + total material diverted + total
  life-extension years.
- Recent activity list: which purchase/trade-in/repair contributed
  what.
- Shareable badge ("I've saved X kg of CO₂ with Onsective") — copy
  link only in this phase; social-share integrations are future.

### 2.6 Public `/impact` page
- Platform totals.
- Top 5 brands by impact this quarter.
- Plain-language methodology section (no scientific claims).

### 2.7 Brand storefront extension
- A "Sustainability impact" panel on the brand storefront (Phase 17)
  surfacing the brand's running totals + a small donut split by
  subjectKind.

### 2.8 Admin factor editor
- Table view + per-row edit at `/admin/sustainability`.
- Each save audit-logged.

## 3. Scope (out)

- Externally-certified carbon offsets or third-party attestation.
- Per-SKU factors (the category granularity matches our data quality;
  per-brand override gives extra precision where needed).
- CSR exports (PDF reports, ESG framework alignment). Future phase.
- Locale-aware unit conversion (everything stays kg / years).
- Real-time webhooks for impact events (we only fire DB writes; if
  brands want webhooks, that piggybacks on the Phase 11 seller-webhooks
  system later).

## 4. Architectural decisions made up front

### 4.1 Snapshotted impact rows, not on-the-fly compute
Every impact event writes its savings as immutable numbers. When
admin updates a factor, *future* events use the new factor; existing
rows stand. This matches the same snapshotting Phase 6 tax does for
order tax lines and Phase 10 promotions do for discount lines.

### 4.2 Factor lookup is two-tier
`(categorySlug, brandId)` row beats `(categorySlug)` row. Brand
overrides are optional; most categories ship with a single row.
This gives flexibility without exploding into per-brand-per-category
maintenance.

### 4.3 Subject FK is loose
`SustainabilityImpact.subjectId` is a plain String (no FK) because
the subject table varies by `subjectKind`. We index `(subjectKind,
subjectId)` so we can find the impact rows for a specific
order/trade-in/ticket. Matches the same loose-coupling pattern
Phase 16 uses for `AiInferenceRun.inputRefId`.

### 4.4 Event listeners, not service-call chains
The sustainability writes happen from a listener subscribed to
`order.paid`, `tradein.order.paid`, and `repair.ticket.completed`.
The source services (Orders, TradeIn, RepairNetwork) don't import
SustainabilityService. Reasoning: sustainability is a derived
read-model layer; an outage of its writes must not affect the
primary lifecycles.

### 4.5 Idempotent listener writes
Listeners check for an existing `(subjectKind, subjectId)` row before
writing. Re-emitted events (e.g., a webhook re-delivery) won't
double-count.

### 4.6 Buyer impact is opt-in for display, not for storage
We always record `buyerUserId` on impact rows (when applicable) so
the aggregation works. Whether the buyer SEES their personal page
respects a future privacy preference — for Phase 20 we assume yes.

## 5. Acceptance criteria

- Admin sets factors for `phones`: kgCo2PerRefurb=55,
  kgMaterialPerRefurb=0.18, lifeExtensionYears=2.
- Buyer buys a REFURB_GRADE_A iPhone. Payment captures → order
  transitions to paid → impact row written for that order item with
  the snapshotted numbers.
- Buyer's `/account/impact` shows hero totals matching the sum of
  their impact rows.
- Public `/impact` shows platform totals matching the sum across
  buyers.
- Brand "Apple" storefront shows a sustainability panel with the
  brand's totals.
- Trade-in completion writes a TRADEIN_PAYOUT impact row.
- Repair completion writes a REPAIR_COMPLETED impact row.
- Admin updates the `phones` factor — past rows untouched, new
  events use the new factor.
- Re-emitting an `order.paid` event for the same order does NOT
  double-write impact rows.
- `doc/phase-20-debug.md` captures decisions + limitations.
