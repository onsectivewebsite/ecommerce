# Phase 22 — Debug Pass

Companion to `phase-22.md`. Decisions made, seams to watch, what to test
before merging.

## 1. The invariants Phase 22 preserves

1. **Lost-update protection in the points ledger.** Every
   `applyDelta` reads the prior balance inside a Prisma transaction,
   writes the `PointsTransaction` row with a snapshotted
   `balanceAfter`, and updates the cached `PointsAccount.balance`.
   This is the same pattern Phase 10 used for `WalletService`. No
   row-level lock is needed because the unique-on-`referenceKey`
   constraint catches duplicate writes and the per-tx read/write
   sequence is bounded.
2. **Idempotent points earning.** Each award carries a
   `referenceKey` (`purchase:<orderId>`, `tradein:<orderId>`,
   `repair:<ticketId>`). Re-emission of the source event is a no-op
   thanks to the unique index. P2002 violations are swallowed and
   logged as a normal idempotent outcome.
3. **Membership snapshot at start.** Price and currency are written
   to `PlusMembership` when the term begins so future price changes
   don't rewrite history. The "renewal" phase that adds Stripe
   Subscriptions can stamp a new row or reuse the same one with
   `renewedAt` set; both work with this model.
4. **Plus benefits never block a primary flow.** Free shipping in
   checkout uses `isActiveForUser(userId)` — if that throws, the
   error propagates from the same place all other checkout reads
   propagate, so the existing error UX stays consistent. Points
   awards run in a listener with try/catch; a write failure logs but
   does not roll back the underlying order.

## 2. Non-obvious decisions

### 2.1 Membership table is separate from sellers' Subscription
Plus is a buyer-side benefits bundle with its own lifecycle, price,
and benefit set. Sellers' Phase 3 subscriptions are a seller-side
contract with payout consequences. Sharing a table would force one
side to compromise. We kept them apart.

### 2.2 Lazy expiry, no scheduler
`MembershipService.getForUser` is the only "expiry" path: if it
reads a row with `status=ACTIVE` and `expiresAt < now`, it flips to
EXPIRED in the same call. Matches the Phase 14 cert pattern. The
trade-off is that a buyer who never interacts with the platform
never gets a "your membership has expired" notification — the
renewal phase will fix that when it adds the scheduler.

### 2.3 Warranty bump is derived, not snapshotted
We do not write the +3mo to OrderItem at checkout. Instead,
`WarrantyService.file` calls `membership.wasActiveAt(userId,
order.createdAt)`. This avoids fanning out yet another OrderItem
column whose value can be derived from existing rows. The downside
is that a back-fill of historical membership rows could change a
past order's effective warranty, but membership rows are
buyer-owned and not retroactively edited.

### 2.4 First-listed timestamp set once
`RefurbUnit.firstListedAt` is set the first time the unit transitions
QUARANTINED→AVAILABLE. If the unit is re-quarantined and goes back to
AVAILABLE later, the stamp does NOT update — the early-access window
ends from the unit's first public appearance, not its most recent.
This matches buyer expectations: a unit they could have seen
yesterday should not become "early access" again today.

### 2.5 Early access is a filter, not a separate route
`/outlet/listings` stays the single source of truth. Plus members
opt in with `earlyAccess=true`; the service checks membership and
either applies the `firstListedAt < cutoff OR NULL` filter (non-Plus
or opted-out) or skips it (verified Plus + opted-in). Old units
with no stamp (`firstListedAt=null`) are always visible — the
filter only hides units listed recently enough to fall inside the
window.

### 2.6 Outlet endpoint uses optional JWT
The endpoint stays anonymous-friendly. We introduced
`JwtOptionalAuthGuard` (small subclass of the existing JWT guard
that swallows auth failures) so we can read the caller's user id
when present without forcing a login for browsing. The membership
check fails closed: no user id → not Plus → filter applies.

### 2.7 Free shipping eats the carrier cost
We still compute the carrier label price and store it in
`OrderItem.shippingMinor` as zero on the buyer's side. The label
the carrier prints is unaffected. The accepted economics are: this
is the membership value. The renewal phase can add accounting to
report the absorbed shipping cost.

### 2.8 Refurb-unit points double via "subtotal copy" trick
We compute `adjustedSubtotalMinor = subtotalMinor +
refurbAndOpenboxSubtotalMinor` and `Math.floor(adjustedSubtotalMinor
/ 100)`. Mathematically equivalent to "1 pt/$1 for normal lines, 2
pt/$1 for refurb/openbox lines" with consistent rounding. The Plus
×1.5 then applies to the combined total.

### 2.9 Mock payment ref in dev
The membership start endpoint accepts any string as `paymentRef`.
In dev, the buyer-web sends `mock_pay_<timestamp>`. In prod, the
renewal phase will replace this with a real Stripe-side payment
intent id. We did not add a payment provider integration in Phase
22 because that's the entire scope of the renewal phase.

## 3. Things to test end-to-end

- `POST /loyalty/membership { plan: 'PLUS_ANNUAL' }` →
  PlusMembership row, ACTIVE, expires in 365 days, pricePaidMinor=7900.
- `GET /loyalty/membership/me` returns the membership + benefits.
- `POST /loyalty/membership/cancel` → status CANCELLED, cancelledAt
  set, expiresAt unchanged. `isActiveForUser` is still true until
  expiry.
- Checkout with an ACTIVE Plus member → `shippingMinor=0` regardless
  of carrier; payment total reflects the zero.
- `order.paid` listener fires → PointsTransaction with kind
  `EARN_PURCHASE` or `EARN_REFURB` (for refurb cart) and amount
  reflecting the multipliers. Re-emit `order.paid` → no duplicate
  row.
- `tradein.order.paid` → 200 pts with `referenceKey=tradein:<id>`.
- `repair.ticket.completed` → 100 pts with
  `referenceKey=repair:<id>`.
- `POST /loyalty/points/redeem { points: 500 }` → 500 pts debited,
  $5 wallet credit posted; statement shows both rows. Re-call with
  a non-multiple of 100 → BadRequestException.
- New OPEN_BOX RefurbUnit goes AVAILABLE → `firstListedAt` stamped.
- Anonymous browser hits `/outlet/listings` immediately after → unit
  not visible. After waiting 24h (or `LOYALTY_EARLY_ACCESS_HOURS=0`)
  → unit visible.
- Signed-in Plus member with `?earlyAccess=true` → unit visible.
- Signed-in non-Plus user with `?earlyAccess=true` → filter still
  applies (the param is honored only for verified Plus members).
- Buyer with ACTIVE Plus at purchase time files warranty claim ~13
  months later on a Grade-A refurb → no error (12 + 3 = 15 month
  window). Same flow for a non-Plus buyer at 13 months → "Platform
  warranty window of 12 month(s) has passed".
- Top-right "Plus" chip renders only for ACTIVE memberships, not
  CANCELLED-but-still-active or EXPIRED.

## 4. Known limitations

- No recurring billing automation. We accept a `paymentRef` and
  capture `pricePaidMinor`; renewal is deferred to a follow-on
  phase that wires Stripe Subscriptions.
- No notification on lazy expiry. The buyer learns by visiting
  `/account/membership`.
- No tier above Plus (Founders, etc.) — single paid tier.
- No points expiry. Points accrue indefinitely.
- No "spend points at checkout" — buyers redeem to wallet first,
  then use wallet at checkout. This keeps the points ledger
  independent of the live checkout path.
- No gift / family memberships.
- Plus chip in TopBar makes a fetch per page-load; can be cached
  in localStorage by a future polish pass.
- Warranty bump display in RefurbUnitPicker re-fetches membership
  state per mount; same caching opportunity.

## 5. Files added

- `services/api/prisma/schema.prisma` — already covered in Phase 22
  spec; the new Phase 22 enums, models, and back-relations.
- `services/api/src/modules/loyalty/membership.service.ts`
- `services/api/src/modules/loyalty/points.service.ts`
- `services/api/src/modules/loyalty/loyalty.controller.ts`
- `services/api/src/modules/loyalty/loyalty.listener.ts`
- `services/api/src/modules/loyalty/loyalty.module.ts`
- `services/api/src/modules/loyalty/dto.ts`
- `services/api/src/modules/auth/jwt-optional.guard.ts`
- `packages/api-client/src/endpoints/loyalty.ts`
- `apps/buyer-web/src/app/account/membership/page.tsx`
- `apps/buyer-web/src/app/account/points/page.tsx`

## 6. Files edited

- `services/api/src/app.module.ts` — registered `LoyaltyModule`.
- `services/api/src/modules/orders/orders.service.ts` — free
  shipping for Plus members in checkout.
- `services/api/src/modules/refurb-units/refurb-units.service.ts` —
  stamp `firstListedAt` on first AVAILABLE transition.
- `services/api/src/modules/returns-disposition/returns-disposition.service.ts`
  — outlet listings filter for non-Plus members; constructor adds
  `MembershipService` + `ConfigService`.
- `services/api/src/modules/returns-disposition/returns-disposition.controller.ts`
  — `OutletPublicController` uses `JwtOptionalAuthGuard` and reads
  optional `CurrentUser`.
- `services/api/src/modules/returns-disposition/dto.ts` — added
  `earlyAccess?` to `OutletListingsQuery`.
- `services/api/src/modules/warranty/warranty.service.ts` — Plus
  warranty bump in `file()`, evaluated against purchase time via
  `membership.wasActiveAt`.
- `packages/api-client/src/index.ts` — re-export `loyalty`.
- `packages/api-client/src/endpoints/outlet.ts` — `earlyAccess`
  query param.
- `apps/buyer-web/src/lib/api.ts` — wired `LoyaltyApi`.
- `apps/buyer-web/src/components/TopBar.tsx` — Plus chip next to
  the user's name when ACTIVE.
- `apps/buyer-web/src/components/RefurbUnitPicker.tsx` — surface the
  Plus-bumped warranty months in the unit row.
- `apps/buyer-web/src/app/account/page.tsx` — added Membership +
  Points links.

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_22_loyalty
pnpm -r typecheck
pnpm -r build
```

Environment knobs (all optional with sensible defaults):

```
LOYALTY_PLUS_ANNUAL_MINOR=7900       # $79.00/yr
LOYALTY_PLUS_MONTHLY_MINOR=999       # $9.99/mo
LOYALTY_POINTS_TRADEIN=200           # flat pts per trade-in payout
LOYALTY_POINTS_REPAIR=100            # flat pts per repair completion
LOYALTY_REDEEM_BPS=100               # 100 cents per 100 pts (1:1)
LOYALTY_EARLY_ACCESS_HOURS=24        # outlet pre-window for Plus
```

The migration adds two new enums (`MembershipPlan`,
`MembershipStatus`, `PointsTransactionKind`), three new tables
(`PlusMembership`, `PointsAccount`, `PointsTransaction`), one new
nullable column on `RefurbUnit` (`firstListedAt`), and two new
back-relations on `User`. No backfill required.
