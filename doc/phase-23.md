# Phase 23 — Recurring Billing for Plus + Saved Payment Methods

Date opened: 2026-05-18
Predecessor: Phase 22 (Loyalty & Membership)

## 1. Why this phase

Phase 22 shipped Onsective Plus as a manual one-shot. The buyer pays
once, gets a 30- or 365-day term, and then the row lazy-expires when
they next ask about it. That's fine for a soft launch but does not
deliver the product Plus is sold as: a recurring membership the
buyer signs up for once.

Phase 23 closes that gap by:

1. Wiring **Stripe Subscriptions** so each PlusMembership is mirrored
   by a real subscription that auto-renews on Stripe's clock.
2. Adding **saved payment methods** so the buyer can attach a card
   once and have it used for renewals, future checkouts (Phase 24+
   wallet top-ups, etc.), and the existing one-shot Payment Intent
   flow.
3. Replacing the `mock_pay_<timestamp>` sentinel from Phase 22 with a
   real `SetupIntent` → attach → subscription-create flow.
4. Handling the four webhook events that matter for a Plus
   subscription lifecycle: `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted`.

Outside of Plus, the new `PaymentMethod` model is a building block for
later work (auto-recharge of wallet, saved-card checkout for repeat
buyers) — but Phase 23 itself only consumes it for membership.

## 2. Scope (in)

### 2.1 PaymentMethod model
```
PaymentMethod {
  id, userId,
  providerCustomerId,        // Stripe customer id, cached on first attach
  providerMethodId @unique,  // pm_xxx
  brand,                     // 'visa' | 'mastercard' | 'amex' | ...
  last4, expMonth, expYear,
  isDefault Boolean,
  status PaymentMethodStatus, // ACTIVE | DETACHED
  createdAt, updatedAt
}
```
- One default per user enforced by `(userId, isDefault)` partial
  unique index conceptually; in Prisma we set isDefault=false on
  every other row of the same user when one is promoted to default.
- DETACHED rows are kept for audit/render — they don't appear in
  list endpoints.

### 2.2 PlusMembership new fields
- `providerSubscriptionId` — Stripe subscription id, nullable for
  legacy Phase-22 rows.
- `autoRenew Boolean @default(true)` — mirrors whether the
  subscription is set to cancel at period end. When the buyer hits
  "cancel" we set `autoRenew=false` AND
  `cancel_at_period_end=true` on the Stripe side; the status stays
  ACTIVE until the period actually ends.
- `currentPeriodEnd DateTime?` — Stripe's source-of-truth period
  end mirrored locally so reads don't need a round-trip.

### 2.3 MembershipBillingEvent model
A thin audit log for renewals + payment failures, keyed by Stripe
event id for idempotency:
```
MembershipBillingEvent {
  id,
  membershipId,
  providerEventId @unique,   // evt_xxx — protects against webhook re-delivery
  kind: MembershipBillingEventKind,  // INVOICE_PAID | INVOICE_FAILED | SUB_UPDATED | SUB_DELETED
  amountMinor?,
  currency?,
  reason?,
  rawSummary?,               // small JSON snapshot of the meaningful fields
  createdAt
}
```

### 2.4 New MembershipStatus value
- `PAUSED` is added to `MembershipStatus`. Set by the webhook when an
  invoice goes through `invoice.payment_failed` and the subscription
  enters `past_due` on Stripe. Plus benefits stop while PAUSED. When
  the buyer fixes the card and Stripe retries successfully, the
  webhook flips it back to ACTIVE with refreshed `expiresAt`.

### 2.5 PaymentMethods service
- `ensureCustomer(userId)` — caches `providerCustomerId` per user
  (carried on the `PaymentMethod` rows; first call creates the
  Stripe customer and stamps the value on the row that gets
  created by `attachSetupIntent`).
- `createSetupIntent(userId)` — returns a Stripe SetupIntent
  client_secret for the buyer-web to confirm with Elements.
- `attachConfirmed(userId, setupIntentId)` — after the buyer
  confirms client-side, the API resolves the SetupIntent, attaches
  the PaymentMethod to the customer, snapshots brand/last4/exp on
  our row.
- `list(userId)` — returns ACTIVE rows.
- `setDefault(userId, paymentMethodId)` — flips `isDefault`, also
  calls `stripe.customers.update({ invoice_settings:
  { default_payment_method } })` so subscription renewals pull the
  right card.
- `detach(userId, paymentMethodId)` — calls `stripe.paymentMethods.detach`,
  marks row DETACHED. Refuses to detach the only ACTIVE method on
  an ACTIVE Plus subscription (would brick the renewal).

### 2.6 MembershipService changes
- `start(userId, plan)` no longer accepts the mock sentinel.
  Required path:
  1. Buyer has at least one ACTIVE PaymentMethod (else 400
     `add a payment method first`).
  2. The service ensures the customer has a default method set on
     Stripe.
  3. Creates a Stripe Subscription on the Price keyed by plan
     (env `LOYALTY_STRIPE_PRICE_ANNUAL` / `LOYALTY_STRIPE_PRICE_MONTHLY`).
  4. Writes the PlusMembership row mirroring the subscription:
     `providerSubscriptionId`, `currentPeriodEnd`, `expiresAt =
     currentPeriodEnd`, `autoRenew=true`, status ACTIVE.
- `cancel(userId)` calls
  `stripe.subscriptions.update(id, { cancel_at_period_end: true })`,
  sets `autoRenew=false`. We do NOT flip status to CANCELLED here —
  Stripe sends a `customer.subscription.updated` and ultimately
  `customer.subscription.deleted` at period end; the webhook drives
  the local state.
- `setAutoRenew(userId, on)` — re-enables auto-renew if the buyer
  changes their mind before the period closes.

### 2.7 Webhook handling
The existing `POST /payments/webhook/stripe` route grows handlers
for the four subscription events:

- `invoice.paid` on a subscription invoice for the Plus price:
  - lookup membership by `providerSubscriptionId`
  - bump `currentPeriodEnd` + `expiresAt` from Stripe
  - set `renewedAt = now`, status ACTIVE
  - write MembershipBillingEvent(INVOICE_PAID)
- `invoice.payment_failed`:
  - status → PAUSED
  - write MembershipBillingEvent(INVOICE_FAILED)
- `customer.subscription.updated`:
  - sync `currentPeriodEnd`, `autoRenew` (mirrors
    `cancel_at_period_end === false`)
  - write MembershipBillingEvent(SUB_UPDATED)
- `customer.subscription.deleted`:
  - status → EXPIRED, stamp `cancelledAt`
  - write MembershipBillingEvent(SUB_DELETED)

All handlers are idempotent on `providerEventId @unique`.

### 2.8 Buyer pages
- `/account/payment-methods` — list of saved cards, "Add card"
  flow using Stripe Elements + SetupIntent, "Make default" /
  "Remove" actions.
- `/account/membership` — gains:
  - default card line ("Visa ···· 4242")
  - "Next renewal: 2027-05-18"
  - Auto-renew toggle (off = cancel at period end; on = re-enable)
  - "Update payment method" link to the methods page

### 2.9 Lazy expiry stays
Even with a webhook source of truth, we keep
`MembershipService.getForUser`'s lazy ACTIVE→EXPIRED flip as a
belt-and-suspenders fallback. If a webhook is dropped or our
sync drifts, the read path still degrades safely.

## 3. Scope (out)

- Auto-recharge of wallet from saved card. The PaymentMethod model
  is the building block; Phase 24+ can pull it.
- Saved-card one-shot checkout. We keep the existing Payment Intent
  flow for orders unchanged.
- Family / shared memberships.
- Proration on plan switches mid-term — buyer cancels current and
  starts new.
- 3DS step-up flows beyond what Stripe Elements + SetupIntent give
  us out of the box.
- Apple Pay / Google Pay wallets. Card-only in Phase 23.

## 4. Architectural decisions made up front

### 4.1 Stripe is the source of truth, local rows mirror
The membership row is a denormalized view of the Stripe
subscription. We never write `expiresAt` from a non-webhook code
path (start() takes the values from the just-created subscription).
This keeps the local read fast without inviting drift.

### 4.2 PaymentMethod owns providerCustomerId, not User
We didn't want to add a new column to the already-wide User table.
A user's Stripe customer id is implied by any of their
`PaymentMethod` rows — `ensureCustomer` looks for one, creates the
Stripe customer if none exists, and stamps it on the row we
create. Lookup is `findFirst` by userId. Trades one extra read
for not touching the auth-hot table.

### 4.3 PAUSED is real, not derived
We considered deriving "paused" from the subscription state on
read. We chose a stored status so all benefit gates
(`isActiveForUser`, free-shipping in checkout) keep their single
check.

### 4.4 SetupIntent over PaymentMethod attach directly
We use a SetupIntent because it lets the card go through 3DS at
attach time. If 3DS is required, Stripe Elements handles it
client-side; on confirm we attach the resolved method.

### 4.5 Cancel = at-period-end only
There is no immediate-cancel button. The buyer paid for the term;
they get the term. If a refund is needed, that's a manual admin
action (not in Phase 23). This matches the current cancel UX
language from Phase 22 ("benefits last until the term ends").

### 4.6 Webhook handler co-located with payments, not loyalty
Stripe-side wiring stays in the payments module. The handler does
a Prisma lookup on `providerSubscriptionId` and updates the
membership row directly. Loyalty doesn't import Stripe types;
payments doesn't import loyalty business logic — they share only
the table.

## 5. Acceptance criteria

- `POST /payment-methods/setup-intent` → returns a client_secret.
  Buyer-web confirms it and calls
  `POST /payment-methods/attach { setupIntentId }` → row written
  with brand/last4 snapshot.
- `POST /payment-methods/:id/default` → flips local + Stripe.
- `DELETE /payment-methods/:id` → row DETACHED on the only
  ACTIVE-Plus card → 400 with explanation.
- `POST /loyalty/membership { plan }` without a default method →
  400 "add a payment method first".
- With a default method → Stripe subscription created,
  PlusMembership written with `providerSubscriptionId`,
  `currentPeriodEnd`, ACTIVE.
- Webhook `invoice.paid` for the sub →  `expiresAt`,
  `currentPeriodEnd`, `renewedAt` updated, status ACTIVE,
  MembershipBillingEvent written. Re-deliver the same webhook →
  no duplicate row (unique on `providerEventId`).
- Webhook `invoice.payment_failed` → status PAUSED, benefits
  stop, billing event written.
- Webhook `customer.subscription.deleted` after a cancellation
  takes effect → status EXPIRED, `cancelledAt` set.
- `/account/membership` shows next renewal date + auto-renew toggle
  + default card. Toggling auto-renew off calls cancel-at-period-end.
- `/account/payment-methods` shows saved cards, default badge,
  add-card flow works end-to-end with Stripe test cards.
- `doc/phase-23-debug.md` captures decisions + limitations.
