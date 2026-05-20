# Phase 22 — Loyalty & Membership

Date opened: 2026-05-18
Predecessor: Phase 21 (Multi-warehouse Smart Routing & SLA)

## 1. Why this phase

The platform rewards circular behavior elsewhere — refurb listings,
trade-in payouts, sustainability impact, repair pipelines. What it
doesn't yet do is turn that into buyer retention. A buyer who returns
twice a year and trades in once has demonstrated they're a high-LTV
customer; we should make sticking around obviously better.

Phase 22 ships two complementary loyalty mechanics:

1. **Onsective Plus** — a paid annual membership ($79/yr default).
   Members get free shipping, extended warranty on refurb/openbox
   units, and early access to outlet drops.
2. **Points** — every paid order earns 1 point per $1 subtotal,
   with a 2× multiplier on refurb/openbox lines and flat bonuses
   for trade-in and successful repairs. Points convert to wallet
   credit at 100 pts = $1.

Both layers reuse existing infra (Phase 10 wallet ledger pattern,
Phase 14 RefurbUnit, Phase 18 outlet, Phase 21 SLA). No new payment
provider is added — membership is started by passing an existing
payment intent reference, leaving recurring renewal logic to a
follow-on phase that can wire Stripe Subscriptions properly.

## 2. Scope (in)

### 2.1 PlusMembership
```
PlusMembership {
  id, userId @unique,
  plan: MembershipPlan,        // PLUS_MONTHLY | PLUS_ANNUAL
  status: MembershipStatus,    // ACTIVE | CANCELLED | EXPIRED | PAUSED
  startedAt, expiresAt, renewedAt?,
  cancelledAt?, cancelReason?,
  // Snapshot of price + currency at sign-up (for the buyer's history view)
  pricePaidMinor, currency,
  // Loose reference to the payment that funded the term — we don't FK
  // because Payment rows are owned by Order in the existing schema.
  paymentRef?
}
```

- Lookup helper: `isActiveForUser(userId)` returns true when there is
  a row with `status=ACTIVE` AND `expiresAt > now`. Stale ACTIVE rows
  past their `expiresAt` are lazily marked EXPIRED on read (same
  pattern Phase 14 used for `SellerCertification` expiry).
- A user has at most one membership row at a time.

### 2.2 Points ledger
- `PointsAccount { userId @unique, balance, currency? }` — currency
  is the redemption currency for wallet conversion (always USD in
  Phase 22; the field is there for future multi-currency).
- `PointsTransaction { accountId, amount, kind, balanceAfter, reason,
  referenceKey @unique?, orderId?, createdAt }`. The `referenceKey`
  prevents duplicate awards from re-emitted events (e.g.
  `purchase:<orderId>`).
- Atomic `applyDelta` modeled exactly on Phase 10
  `WalletService.applyDelta` — reads prior balance inside a Prisma
  transaction, writes the txn row, updates the account's cached
  balance.

### 2.3 Earning rules
- `purchase:<orderId>` — 1 pt per $1 of `subtotalMinor / 100`, rounded
  down. Each refurb/openbox line gets 2× on its own subtotal portion.
  Tier multiplier: ACTIVE Plus member gets ×1.5 on the entire award.
- `tradein:<orderId>` — flat 200 pts on trade-in payout.
- `repair:<ticketId>` — flat 100 pts on repair completion.
- Each award uses a `referenceKey` so re-emits are idempotent.

### 2.4 Redemption
- `redeemToWallet(userId, points)` — converts at 100 pts = $1
  (configurable via `LOYALTY_REDEEM_BPS`, default 100 cents per
  100 pts). Atomic: debits points, credits wallet via the existing
  `WalletService.applyDelta` with reason "Points redemption".
- Minimum redeem = 100 pts. Multiples of 100 only.

### 2.5 Benefits enforcement at checkout
- `OrdersService.checkout` consults `MembershipService.isActiveForUser`
  before computing shipping. ACTIVE Plus members get
  `effectiveShipping = 0` regardless of carrier (carrier still
  computes a label cost; we eat the difference — this is the
  membership value).
- Listener on `order.paid` awards points.

### 2.6 Refurb warranty bump
- `RefurbUnit.warrantyMonths` is the stored default. When a Plus
  member views or purchases a refurb unit, the rendered/effective
  warranty is `stored + 3 months` (clamped at 24). PDP renders the
  bumped figure when the buyer is Plus.
- For purchases by Plus members, we don't mutate the RefurbUnit
  row; the warranty service (Phase 14) just adds the bump when a
  claim window is computed and the buyer is a Plus member as of the
  purchase date.

### 2.7 Outlet early access
- Outlet listings (Phase 18 `/outlet/listings`) gain a query flag
  `earlyAccess=true` for Plus members. New OPEN_BOX RefurbUnits are
  tagged with `firstListedAt`; non-Plus buyers only see units where
  `firstListedAt < now - <window>` (default 24h, configurable via
  `LOYALTY_EARLY_ACCESS_HOURS`).
- Plus members see everything.

### 2.8 Buyer pages
- `/account/membership` — shows status, plan, expiry, benefits.
  Start / cancel buttons. Sign-up uses an existing payment provider
  intent (mock provider in dev returns a synthetic ref).
- `/account/points` — balance, statement, "redeem to wallet" form.

### 2.9 TopBar chip
- Signed-in Plus members see a small "Plus" chip next to their name
  in the TopBar.

## 3. Scope (out)

- Recurring billing automation. We capture a `pricePaidMinor` and
  `paymentRef` at start; auto-renewal needs Stripe Subscriptions
  proper, deferred.
- Family / shared membership.
- Tier above Plus (e.g., Founders). One paid tier in Phase 22.
- Points expiry. Points accrue indefinitely for now.
- Points spending at checkout. Phase 22 only redeems to wallet;
  the buyer then uses wallet at checkout via the existing Phase 10
  flow.
- Gift memberships.

## 4. Architectural decisions made up front

### 4.1 Reuse the wallet ledger pattern
`PointsService.applyDelta` is the spitting image of
`WalletService.applyDelta`: read prior balance in a tx, compute,
write the txn row with `balanceAfter` snapshot, update the cached
account balance. Same lost-update protection. Choosing the same
pattern over an entity event store keeps the codebase consistent
and operator mental model identical.

### 4.2 Idempotent earn via referenceKey
Every PointsTransaction can carry a `referenceKey @unique`. Callers
that earn from events (`purchase:<orderId>`,
`tradein:<orderId>`, `repair:<ticketId>`) supply one; duplicate
writes are no-ops thanks to the unique constraint. Same shape
Phase 20 uses for `SustainabilityImpact (subjectKind, subjectId)`.

### 4.3 Membership status is lazy-expired on read
We don't run a scheduler. `isActiveForUser` checks the row and, if
`status=ACTIVE` but `expiresAt < now`, flips to EXPIRED in the same
read transaction. Pros: zero moving parts. Cons: a buyer doesn't
get a "your membership has expired" notification until something
else asks the question. Acceptable for Phase 22; the renewal phase
will add a scheduler when it adds Stripe Subscriptions.

### 4.4 Warranty bump is computed, not stored
`RefurbUnit.warrantyMonths` stays the base. When a buyer who is
ACTIVE Plus at purchase time files a claim, the warranty window
adds the bump. We don't snapshot the bump onto the OrderItem
because the resolution criterion is "Plus at purchase time" and
we already have the order's `createdAt` plus a membership lookup.
This avoids fanning out yet another OrderItem column.

### 4.5 Early outlet access via timestamp + filter, not separate listings
We add `RefurbUnit.firstListedAt` (set when the unit transitions to
AVAILABLE) and filter the public outlet endpoint on that against
the early-access window. Plus members request `earlyAccess=true`
and skip the filter. One source of truth for "what's available"
with a thin filter on top.

### 4.6 No buyer-side payment intent abstraction for membership
We accept a `paymentRef` string at start. The buyer-web's start
flow can pass anything — in dev the mock payment provider returns
a synthetic id, in prod a real charge id. This sidesteps building
a new subscription-payment flow inside Phase 22 while leaving the
contract right for the renewal phase to pick up.

## 5. Acceptance criteria

- Buyer hits `POST /loyalty/membership` with plan `PLUS_ANNUAL` and
  a payment ref → PlusMembership row written, status ACTIVE,
  expires 365 days out, pricePaidMinor=7900, currency=USD.
- `GET /loyalty/membership/me` returns the membership.
- Buyer checks out → `shippingMinor = 0` regardless of carrier.
- `order.paid` fires → PointsTransaction awarded with the right
  multipliers. Re-emit `order.paid` → no duplicate.
- Buyer hits `POST /loyalty/points/redeem` with 500 pts → 500 pts
  debited, $5 wallet credit posted.
- Buyer with no membership sees outlet listings older than 24h.
  Plus member sees everything including just-listed units.
- Buyer's `/account/membership` shows status + benefits + "Cancel"
  button. Cancelling sets status CANCELLED but keeps expiresAt so
  benefits last until the term ends.
- Buyer's `/account/points` shows balance + statement.
- Refurb PDP for a Plus member shows extended warranty months.
- `doc/phase-22-debug.md` captures decisions + limitations.
