# Phase 18 — Returns Liquidation & Outlet

Date opened: 2026-05-18
Predecessor: Phase 17 (Brand Storefronts)

## 1. Why this phase

Phase 9 added Returns. Today, when a buyer returns an item, the refund
posts and the physical unit lands at a warehouse with no formal
disposition flow — it just sits. That's both an inventory loss and a
missed revenue path: a like-new returned unit can be re-listed at a
modest discount, recovering most of the COGS while still giving buyers
a value proposition.

Phase 18 makes the physical disposition explicit. When a returned unit
arrives at the warehouse, a technician records a `ReturnInspection`
that assigns one of four disposition paths:

1. **OUTLET_RELIST** — like-new, sealed, or minimal cosmetic issues.
   Auto-create an `OPEN_BOX` RefurbUnit on the same product at a
   discount. Phase 14 auth gate still runs before sale.
2. **REFURB_REGRADE** — has issues but salvageable. Route to the
   refurb-grading pipeline (Phase 15) for grading + re-list as a
   normal refurb unit.
3. **DISPOSE** — beyond economic repair. Write off. Audit trail
   records the reason.
4. **RETURN_TO_SELLER** — for seller-fulfilled returns where the
   seller wants the unit back; ship it.

The buyer side gets `/outlet`, a discount-forward page that aggregates
OPEN_BOX + REFURB_GRADE_* units, sorted by best discount-vs-MSRP. The
same Phase 14 TrustBadge + AuthenticityCheck guarantees apply.

## 2. Scope (in)

### 2.1 OPEN_BOX condition
- Extend `ProductCondition` enum with `OPEN_BOX`.
- OPEN_BOX is a refurb-style listing in every architectural respect:
  per-unit `RefurbUnit` row, singleton variant, Phase 14
  AuthenticityCheck gate before AVAILABLE, platform-backed warranty.
- Default platform warranty: 6 months (between Grade-A 12 and Grade-B 6
  — reflects "newer than refurb but inspected").
- Default discount: 10–15% off the source product's base price. The
  exact discount is configurable per disposition.

### 2.2 ReturnInspection
- One row per Return. Fields: `{ id, returnId, technicianUserId,
  warehouseId, disposition, conditionNotes, photoUrls,
  outletDiscountBps?, createdRefurbUnitId?, createdAt }`.
- The Return → Inspection relation is 1:1.
- Returns without an inspection cannot transition to "closed" — the
  buyer's refund is independent (already handled), but the unit's
  physical state must be resolved.

### 2.3 Return-disposition service
- `ReturnsService` doesn't change; we add a sibling
  `ReturnDispositionService` so the existing returns code stays small.
- Warehouse staff hit `POST /warehouse/returns/inspect` with the
  return id, disposition, photos, notes, optional discount override.
- OUTLET_RELIST creates a RefurbUnit with:
  - `productId` = the original product
  - `serialNumber` = `RT-<returnId-suffix>` (synthetic; returns
    don't always have a serial)
  - `priceMinor` = `round(basePriceMinor * (1 - discountBps/10000))`
  - `availability = QUARANTINED` (Phase 14 gate still applies)
  - Synthetic singleton ProductVariant created (same pattern as
    Phase 14 `RefurbUnitsService.create`)
- REFURB_REGRADE emits `return.refurb-regrade` for the refurb
  pipeline to pick up (no schema link — the existing trade-in
  pipeline doesn't need to own returns).
- DISPOSE just records.
- RETURN_TO_SELLER creates a reverse shipment placeholder (mock
  label, same as Phase 15).

### 2.4 Outlet route
- Buyer `/outlet` aggregates products with condition in
  `[OPEN_BOX, REFURB_GRADE_A, REFURB_GRADE_B, REFURB_GRADE_C]` that
  have at least one AVAILABLE RefurbUnit.
- Each card shows the discount vs the source product's
  `basePriceMinor` (we compute the cheapest available unit's price
  against the base).
- Filterable by condition and brand (lightweight — query params, no
  facets in this phase).

### 2.5 Repeat-dispose seller-health signal
- A seller whose returns disposition is DISPOSE more than 10% of the
  time over the last 90 days takes a small seller-health hit. The
  signal is emitted as `return.disposed`; the existing seller-health
  scheduler picks it up via a new aggregated input.

### 2.6 Admin queue
- `/admin/returns/dispositions` shows pending Returns (RECEIVED but
  no Inspection) and a histogram of recent disposition counts.

## 3. Scope (out)

- Buyer-facing outlet promotions/coupons stacking — outlet items are
  already discounted; no additional promo math in this phase.
- Automatic ML grading of returns (Phase 16 AI assist can be
  leveraged, but this phase ships with the existing human flow).
- Cross-warehouse re-shipping (returned at WH-A but the OPEN_BOX
  listing routed via WH-B). Returns re-list from the warehouse that
  received them.

## 4. Architectural decisions made up front

### 4.1 OPEN_BOX as a `ProductCondition` enum value
We considered a separate "openBox" boolean on RefurbUnit. Rejected:
the buyer-side filter and the TrustBadge UI both already key on
`condition`, and treating OPEN_BOX as a fourth grade slots in cleanly
with zero code-path changes downstream. Trade-off: products with
mixed condition would need separate product shells (one NEW_GENUINE,
one OPEN_BOX). We accept that — the same pattern already exists for
refurb (separate shell per grade).

### 4.2 ReturnInspection sibling, not extension
Adding inspection fields to the existing `Return` row would couple
the buyer-side returns workflow (refund/approve/etc.) to the
warehouse-side physical disposition. Keeping them in separate tables
keeps each lifecycle independent. The 1:1 link is a unique FK.

### 4.3 OUTLET_RELIST re-uses the Phase 14 unit-creation pattern
The same singleton-variant + QUARANTINED-until-AuthCheck-PASS pattern
Phase 14 ships for refurb units. We deliberately do NOT add a
back-door that releases stock without the human auth gate. Single
chokepoint for "stock goes live" is preserved.

### 4.4 Synthetic serial for returns
Returns rarely arrive with a usable serial. We synthesize one
(`RT-<suffix>`) so the existing per-unit lookup, `/verify` route,
and AI signals all keep working. Returns that DO have a known serial
can be backfilled later via an admin edit.

### 4.5 Discount baked into priceMinor
We don't add a "discount" column to RefurbUnit. The price IS the
price; the discount math is done at inspection time and surfaced on
the outlet page by comparing against the source product's
`basePriceMinor`. Simpler model, no two-source-of-truth risk.

## 5. Acceptance criteria

- Buyer returns an order (existing flow). Refund posts as today.
- Warehouse receives the return. Status reaches a "physically here"
  state that admin can see.
- Technician inspects via `POST /warehouse/returns/inspect` with
  disposition OUTLET_RELIST and 15% discount → an OPEN_BOX
  RefurbUnit is auto-created on the source product, QUARANTINED,
  priced at 85% of MSRP.
- Run the Phase 14 AuthenticityCheck PASS → the unit becomes
  AVAILABLE → it appears on the source product's PDP refurb picker
  AND on the new `/outlet` page with a clear "15% off" badge.
- Re-inspect a different return as REFURB_REGRADE → no RefurbUnit
  is auto-created; a `return.refurb-regrade` event fires that the
  existing refurb operator can manually pick up.
- Inspect as DISPOSE with reason → record + event fired.
- A seller whose dispositions are >10% DISPOSE in the rolling window
  shows a lower health snapshot next time the scheduler runs.
- `doc/phase-18-debug.md` captures decisions + limitations.
