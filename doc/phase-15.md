# Phase 15 — Trade-in & Circular Loop

Date opened: 2026-05-18
Predecessor: Phase 14 (Authenticity & Certified Refurbished)

## 1. Why this phase

Phase 14 made Onsective a certified-only platform. That works only as
long as we have **supply** of grade-A/B/C refurbished units. Buying
inventory from refurbishers and OEMs alone won't scale. The most
defensible way to source supply is to buy back used units directly from
the buyer base — every shipped product is a future trade-in.

Phase 15 closes the loop:

```
buyer device → quote → ship-back → warehouse intake → grade
            ↓                                            ↓
        wallet credit                                refurbisher
        (or Stripe)                                      ↓
                                                   re-listed as
                                                   RefurbUnit on PDP
```

The same RefurbUnit primitive Phase 14 introduced becomes the output of
the trade-in pipeline. Drop-ship is still out of scope; every traded-in
unit physically passes through an Onsective warehouse OR a verified
refurbisher's warehouse before re-listing.

## 2. Scope (in)

### 2.1 Trade-in model catalog
- `TradeInModel` rows describe what we'll accept and how much we pay
  by declared condition. Keyed by `productId`. Admin-managed.
  - `baseOfferMinor` — what we'd pay for a pristine, accessories-complete
    unit.
  - `gradeMultipliers` JSON: `{GRADE_A: 0.85, GRADE_B: 0.6, GRADE_C: 0.3, REJECT: 0}`.
  - `accessoryAdjustments` JSON: `[{key: 'box', amountMinor: 500}, ...]`.
  - `enabled` toggle.
- A model can be created only against an existing refurb-grade product
  (the *destination* product the re-listed unit will attach to).
  Practically: every NEW_GENUINE product has a sibling REFURB_GRADE_A
  product with the same brand/category — the model points at the
  destination so Phase 15 knows where to attach the re-listed RefurbUnit.

### 2.2 Quote engine
- Buyer hits `POST /trade-in/quotes` with `{productSlug,
  declaredCondition, accessories[]}`. Returns:
  - `offerMinor` (capped at base price, never negative),
  - `currency`,
  - `quoteId` + `expiresAt` (24h TTL),
  - `requiresPhotos: boolean` (true for declared GRADE_A — we ask for a
    photo at intake), false otherwise.
- Quote is signed (HMAC of {quoteId, offerMinor, expiresAt}) so it can't
  be tampered with after issue. The same HMAC is verified at acceptance.

### 2.3 Trade-in order
- Buyer accepts quote → `POST /trade-in/orders` (must be authed; quote
  must not have expired; signature must verify).
- `TradeInOrder` written with status `CREATED`.
- Routing service picks a receiving warehouse using existing Phase 13
  RoutingService (same country preference rules).
- Carrier abstraction creates an *inbound* shipping label paid by
  Onsective — uses the existing `ShippingService` adapter with a
  reverse-direction flag. (Mock provider returns a placeholder label so
  the flow is testable end-to-end.)
- Status timeline: `CREATED → KIT_SHIPPED → IN_TRANSIT → RECEIVED →
  GRADED → PAID` or any of: `REJECTED`, `CANCELLED`.
- Buyer can cancel before `RECEIVED`.

### 2.4 Intake + grading
- Warehouse staff scan the inbound and create `TradeInIntake`
  (receivedAt, photos, conditionNotes, technicianUserId).
- A `TradeInGrading` row decides the final grade:
  - `actualGrade`: GRADE_A | GRADE_B | GRADE_C | REJECT.
  - If actualGrade < declaredGrade → `payoutMinor` is recomputed using
    the same model rules (so a buyer can't game the system by declaring
    pristine).
  - Approve path: write the payout, transition to `PAID`.
  - Reject path: buyer is notified, can opt to have the unit returned at
    their cost OR recycle (default — Onsective disposes responsibly).
- A failed grading does *not* hit `SellerHealthSnapshot` (the buyer
  isn't a seller). It does increment a per-buyer
  `TradeInRejectRate` metric that the risk engine can use to flag
  pattern abuse.

### 2.5 Payout
- Default: wallet credit (CREDIT_GRANT kind, reason "Trade-in payout").
  Reuses Phase 10 wallet — instant, no processor.
- Optional: cash-out to original payment method via existing payments
  abstraction — opt-in, only above a $50 threshold to keep fees sane.
  Stripe transfer in dev mode is a mock no-op.

### 2.6 Auto re-list as RefurbUnit
- On grading approval, automatically create a `RefurbUnit` against the
  trade-in model's destination product.
- The created RefurbUnit is marked `QUARANTINED` (Phase 14 default) so
  the warehouse still has to run an authenticity check before stock goes
  live — even though we just received and graded it. This keeps a
  single, auditable gate (the Phase 14 AuthenticityCheck) for *every*
  live unit.
- Pricing: `roundedRetailPrice = max(payout + handlingMargin, floor)`
  with `handlingMargin = max(0.4 * payout, $25)` and `floor = payout +
  $10`. Admin can override before publishing.
- The RefurbUnit's `sellerId` is the platform house-seller (a special
  Seller row, slug `onsective-house`). House-seller can hold an
  always-active `CERTIFIED_REFURBISHER` certification.

### 2.7 Refurbisher routing (optional)
- If a `TradeInModel.assignedRefurbisherId` is set, the routing step
  instead picks the refurbisher's verified warehouse. The
  RefurbUnit's `sellerId` becomes that refurbisher. The refurbisher's
  payout is the trade-in payout minus a platform fee (configurable per
  refurbisher).
- House refurbishing is the simpler default and ships first; refurbisher
  routing is wired but defaults off.

### 2.8 Buyer trust UI
- `/trade-in` landing page with the quote form and a "How it works"
  block emphasizing the auth gate (so buyers know we're not just
  flipping their device).
- `/account/trade-ins` shows quote/order status, payout receipts, and
  the link to the re-listed unit when applicable (small "see your
  device on sale" link — it's a satisfying loop closure).

## 3. Scope (out)

- Computer-vision auto-grading (Phase 16).
- Cross-border trade-in (single-country only — same as existing
  shipping limitations).
- Bulk trade-in for businesses (one-unit-per-order in Phase 15).

## 4. Architectural decisions made up front

### 4.1 Quote signing
We sign quotes (HMAC-SHA256, server-side key, same `KeyCrypto` pattern
as Phase 12 webhook signatures) instead of storing them. Cheap, easy
revocation by rotating the key. The quoteId is still persisted so
acceptance can audit-trail back to it.

### 4.2 RefurbUnit auto-create on grade approval
This makes the trade-in pipeline a *producer* of supply for the refurb
inventory pool with no manual hand-off. The AuthenticityCheck gate
still applies, so we keep one consistent enforcement point for "stock
goes live."

### 4.3 Wallet payout default
Phase 10 wallet already handles concurrency-safe deltas and ledger
linkage. For the buyer it's instant. For Onsective it avoids per-payout
processor fees. Cash-out is an opt-in escape hatch.

### 4.4 House-seller for default refurbishing path
Rather than make every trade-in require an external refurbisher,
Onsective itself is a seller (`onsective-house`). This lets us ship
Phase 15 without depending on Phase 14's certified-refurbisher onboarding
being mature — but the same Phase 14 rules apply to the house seller, so
the auth/cert checks are identical code paths.

### 4.5 Reject-rate metric, not seller-health
A buyer who consistently overstates device condition is *abusing the
trade-in flow*, not selling. Their `tradeInRejectRate` over the last 90
days feeds the risk engine as a Phase 12 risk-factor input. No suspend
threshold initially — just a signal.

## 5. Acceptance criteria

- Admin creates a `TradeInModel` for "iPhone 13 — pristine baseline $400,
  Grade A 0.85, Grade B 0.6, Grade C 0.3" pointing at the existing
  "iPhone 13 (Refurbished)" product.
- Buyer requests a quote for that product as declared GRADE_A with
  accessories `[box, charger]`. Gets `$340 + $5 box + $0 charger = $345`,
  signed, valid 24h.
- Buyer accepts the quote → `TradeInOrder` CREATED → kit ships → buyer
  mails device → warehouse marks RECEIVED → technician grades as actual
  GRADE_B → payout recomputes to $240 → wallet credit posts → buyer
  notified → RefurbUnit auto-created on the destination refurb product
  with `availability=QUARANTINED`.
- Warehouse runs the Phase 14 AuthenticityCheck PASS → unit becomes
  AVAILABLE on the PDP. The buyer's `/account/trade-ins` shows "your
  device is now live: <link>".
- Reject path: technician grades as REJECT → buyer is notified and can
  opt to pay return shipping OR recycle (default recycle in dev).
- `doc/phase-15-debug.md` captures decisions + known limitations.
