# Phase 18 — Debug Pass

Companion to `phase-18.md`. Decisions made, seams to watch, what to
test before merging.

## 1. The invariant Phase 18 preserves

**Single chokepoint for "stock goes live."** An OUTLET_RELIST creates
a RefurbUnit at `availability = QUARANTINED`. Stock only transitions
to AVAILABLE through the same Phase 14 `AuthenticityCheck` PASS that
all other refurb stock walks through. There is no backdoor where a
returned unit becomes purchasable without the human auth gate.

## 2. Non-obvious decisions

### 2.1 OPEN_BOX as a `ProductCondition` enum value
We added OPEN_BOX rather than a separate "openBox" boolean on
RefurbUnit. Reasoning: the buyer-side filter, the TrustBadge, the
PDP picker, and the outlet aggregator all already key on
`condition`. Slotting OPEN_BOX into the enum was zero downstream
change vs. the alternative.

Trade-off: a product that has both NEW_GENUINE listings and OPEN_BOX
units uses two product shells. Same pattern already exists for refurb
grades (separate shell per grade), so this isn't a new shape.

### 2.2 Synthetic serial number for returns
Returns rarely have a usable serial. We synthesize one
(`RT-<returnId-suffix>`) so the existing per-unit lookup, the
`/verify` route, and AI signals all keep working. The pattern mirrors
the trade-in pipeline's `TI-<orderId-suffix>` synthetic serials.

### 2.3 Discount baked into priceMinor
We don't add a discount column to `RefurbUnit`. The price IS the
price. The outlet page computes the discount on read by comparing the
RefurbUnit's `priceMinor` to the source product's `basePriceMinor`.
Single source of truth.

### 2.4 ReturnInspection sibling table
Inspection fields live on a separate `ReturnInspection` row, 1:1 with
Return. Reasons: keeps the buyer-side returns workflow (refund/
approve/reject) decoupled from the warehouse-side disposition. Each
lifecycle is independent. The 1:1 link is enforced by a unique FK.

### 2.5 OUTLET_RELIST requires a single-item return tied to a known product
Multi-item returns can't be auto-relisted because we'd need to make
a per-item creation decision (and possibly different dispositions per
item). Operators handle those manually via REFURB_REGRADE for now.
Single-item is the >95% case from typical retail patterns.

### 2.6 Phase 18 events, not direct cross-module calls
`return.refurb-regrade` and `return.ship-back-to-seller` are emitted
as events for downstream consumers (the existing refurb pipeline,
shipping module) to pick up rather than calling those services
directly from `ReturnsDispositionService`. Keeps the new module's
dependency graph small.

### 2.7 Seller-health input not wired in this phase
The spec calls for a DISPOSE-rate seller-health signal. The event
`return.disposed` fires with `{ sellerId, disposition }` but the
existing `SellerHealthService` aggregates from DB tables (not events),
and adding a new aggregate input requires touching that service's
weighting math. Deferred — captured in section 4.

### 2.8 Standalone `ReturnsDispositionService`
We did not extend `ReturnsService`. The buyer-side returns flow is
already complex (request/approve/reject/refund/ship-back). Adding
warehouse-side disposition into the same service would couple two
unrelated lifecycles. The new module is sibling, registered globally
so existing modules can subscribe to its events without import
ordering pain.

## 3. Things to test end-to-end

- Buyer returns a single-item order. Refund posts as today.
- Warehouse opens `/returns` in shipping-web, sees the return in the
  queue. Picks OUTLET_RELIST + 15% discount + notes + photo URLs.
  Submits.
- `GET /outlet/listings` does NOT yet include the unit (still
  QUARANTINED).
- Warehouse runs the Phase 14 AuthenticityCheck PASS for the new
  RefurbUnit → `availability` flips to AVAILABLE → the unit appears
  on the source product's PDP refurb picker AND on `/outlet` with a
  "15% off" badge.
- Try inspecting the same return twice → 409 ConflictException
  ("Return already inspected").
- Try OUTLET_RELIST on a multi-item return → 400 BadRequest.
- Try DISPOSE without a reason → 400 BadRequest.
- Try DISPOSE with reason → row written, `return.disposed` event
  fired, no RefurbUnit created.
- REFURB_REGRADE → row written, `return.refurb-regrade` event fired,
  no RefurbUnit created (deliberate — operator picks up manually).
- Outlet filter buttons (All / Open box / Grade A / B / C) round-trip
  through the URL query and update the grid.

## 4. Known limitations

- DISPOSE-rate seller-health input not wired (see 2.7).
- AI-assisted disposition: the Phase 16 grading provider could
  suggest a disposition class. Plumbing is straightforward
  (`/ai/suggest/grading` already exists) but not wired into the
  returns intake panel yet.
- Reverse shipping for RETURN_TO_SELLER uses a mock label same as
  Phase 15. Real carrier integration is a future ops task.
- Multi-item return handling for OUTLET_RELIST. Operators have to
  REFURB_REGRADE; a multi-line OUTLET_RELIST UI could be a follow-up.
- No automated repricing when the source product's basePriceMinor
  changes. Outlet listings show the discount-at-creation; the source
  msrp could drift. Acceptable for now since outlet listings are
  short-lived (single physical unit each).

## 5. Files added

- `services/api/src/modules/returns-disposition/{returns-disposition.service,returns-disposition.controller,returns-disposition.module,dto}.ts`
- `packages/api-client/src/endpoints/outlet.ts`
- `apps/buyer-web/src/app/outlet/page.tsx`
- `apps/shipping-web/src/app/returns/page.tsx`
- `apps/admin-web/src/app/dispositions/page.tsx`

## 6. Files edited

- `services/api/prisma/schema.prisma` — added `OPEN_BOX` to
  `ProductCondition`, added `ReturnDisposition` enum, added
  `ReturnInspection` model with back-relations on `Return` and
  `Warehouse`.
- `services/api/src/app.module.ts` — registered `ReturnsDispositionModule`.
- `packages/api-client/src/index.ts` — re-export `outlet`.
- `packages/shared-types/src/dto/catalog.ts` — added `OPEN_BOX` to
  the `ProductCondition` type.
- `apps/{buyer,admin,shipping}-web/src/lib/api.ts` — wired
  `OutletApi` / `ReturnsDispositionApi` where appropriate.
- `apps/buyer-web/src/components/TrustBadge.tsx` — added OPEN_BOX
  configuration.
- `apps/buyer-web/src/components/TopBar.tsx` — added Outlet nav link.
- `apps/admin-web/src/components/Shell.tsx` — added Dispositions nav.
- `apps/shipping-web/src/components/Shell.tsx` — added Returns intake nav.

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_18_returns_outlet
pnpm -r typecheck
pnpm -r build
```

The migration adds:
- New enum value `OPEN_BOX` on `ProductCondition`.
- New enum `ReturnDisposition`.
- New table `ReturnInspection` with unique FK on `returnId`.

No data backfill needed — existing returns get no inspection row, so
the new admin queue starts populated with everything that's ever been
returned. Operators will need to clear historical backlog manually,
or the `pendingQueue()` filter can be tightened to "created in the
last N days" if backlog is too large.
