# Phase 24 — Saved-Card Checkout & Plus Operations

Date opened: 2026-05-18
Predecessor: Phase 23 (Recurring Billing & Saved Cards)

## 1. Why this phase

Phase 23 shipped Plus auto-renewal and the `PaymentMethod` model
but explicitly punted three things that the new product line
needs in order to run as an actual business:

1. **Saved-card one-shot checkout.** Buyers now have cards on file
   for Plus renewals but still see the full PaymentIntent flow on
   every order. They expect "pay with my Visa ····4242" to be one
   tap.
2. **Plus lifecycle comms.** A buyer's card fails silently and
   their benefits vanish — there is no email, no push. Renewals
   are equally invisible. Expiring-soon nudges don't exist.
3. **Admin visibility into Plus.** Ops can't see how many Plus
   members are active, what the recurring revenue is, or who
   recently churned. Today they'd have to query the DB.

Phase 24 closes all three with one coherent scope — buyer
experience plus an ops surface for the team that runs Plus.

## 2. Scope (in)

### 2.1 Saved-card one-shot checkout
- `CheckoutDto` gains optional `savedPaymentMethodId`. When set,
  `OrdersService.checkout` resolves the user's PaymentMethod,
  creates a Stripe PaymentIntent with
  `payment_method`, `confirm=true`, `off_session=true` so the
  capture happens server-side without a fresh confirm round-trip.
- The buyer-web checkout page gains a "Pay with saved card"
  selector listing the buyer's ACTIVE methods (default at the
  top). Choosing "New card" falls through to the existing flow.
- **3DS step-up handling.** If Stripe returns
  `authentication_required`, the API surfaces a 422 with the
  PaymentIntent `client_secret` and the buyer-web flips to a
  Stripe Elements `confirmCardPayment` flow inline so the buyer
  can complete SCA. On confirm, the existing
  `payment_intent.succeeded` webhook captures the order normally.

### 2.2 Plus lifecycle notifications
A new `PlusNotificationsListener` consumes the three Phase-23
events:

- `membership.subscription_invoice_paid` → category
  `plus_renewed`: "Your Onsective Plus membership renewed."
- `membership.subscription_invoice_failed` → category
  `plus_payment_failed`: "Action needed: your Plus payment
  didn't go through."
- `membership.subscription_deleted` → category `plus_expired`:
  "Your Onsective Plus membership has ended."

Plus a `PlusExpiringSoonScheduler` that walks ACTIVE memberships
with `autoRenew=false` and `currentPeriodEnd` within the next
window (default 7d, env `LOYALTY_EXPIRING_SOON_DAYS`) and emits
category `plus_expiring_soon` at most once per term via a
`MembershipBillingEvent(kind=NOTICE_SENT)` row keyed by
`reminder:<membershipId>:<currentPeriodEnd-iso>` so the email
doesn't repeat if the scheduler runs again.

All four use existing `EmailService.sendToUser` patterns — new
templates added to `email/templates.ts`.

### 2.3 Admin Plus dashboard
- `GET /admin/plus/stats` returns:
  - `activeCount` — current ACTIVE memberships with
    `expiresAt > now`.
  - `pausedCount` — PAUSED memberships (payment-failed in-flight).
  - `mrrMinor` — sum of monthly-equivalent revenue across ACTIVE
    rows: annual divides by 12, monthly is itself.
  - `churnedLast30d` — EXPIRED rows with `cancelledAt` within
    the last 30 days, broken down by plan.
  - `newLast30d` — rows with `startedAt` within the last 30 days.
- `GET /admin/plus/billing-events?limit=&kind=` returns recent
  MembershipBillingEvent rows joined with the user email + plan.
- `/admin/plus` page in admin-web renders KPIs + a recent-events
  table with the event kind, user, amount, timestamp.

## 3. Scope (out)

- Apple Pay / Google Pay in saved-card checkout — `CardElement`
  only, same as Phase 23.
- Multi-card subscription failover (try card B if A declines).
  Stripe handles this if the buyer marks a different card as
  default; we don't try cards in sequence.
- Self-serve refund of a Plus invoice from the admin UI. Phase 9
  refund flow remains the path for order refunds; Plus invoice
  refunds need the admin to use the Stripe dashboard for now.
- Per-event email throttling beyond once-per-term for the
  expiring-soon reminder. Renewed / failed / expired are
  effectively one-shot per event, no throttle needed.
- Mobile parity. The Expo app still shows Plus as read-only
  (Phase 7 already covers the core shopping flow). A dedicated
  pass to wire saved-card checkout + membership management in
  the mobile app can come later if usage warrants it.

## 4. Architectural decisions made up front

### 4.1 Off-session confirm at checkout creation
Saved-card orders skip the client-confirm round trip. We use
`confirm=true, off_session=true` on PaymentIntent create. If
Stripe accepts it, the webhook fires the same
`payment_intent.succeeded` path — order goes PAID. If 3DS is
required, we catch the specific Stripe error code
(`authentication_required`) and surface the existing
PaymentIntent's `client_secret` so the buyer can complete
authentication inline. The order row is already written; only
the payment capture is pending. This matches how Stripe expects
SCA to be reflowed.

### 4.2 Reuse existing email category infrastructure
Email category strings (`plus_renewed`, etc.) plug into the
existing per-category opt-out (`NotificationPreference`) so
buyers can disable Plus emails individually if they want. No new
preference UI needed — the existing per-category page picks them
up.

### 4.3 Once-per-term reminder via MembershipBillingEvent
The `expiring_soon` reminder uses a new kind on the existing
`MembershipBillingEvent` table (`NOTICE_SENT`) with a synthetic
`providerEventId` of the form
`reminder:<membershipId>:<currentPeriodEnd>`. Unique-on-providerEventId
means a second scheduler tick this term is a no-op. We picked
this over a new table because the audit log is the right place
for "we sent a reminder about this membership."

### 4.4 Admin stats derived live, not materialized
`activeCount`, `mrrMinor`, `churnedLast30d` come from queries
hitting indexed columns on `PlusMembership` (`status`,
`expiresAt`). N stays in the hundreds even at scale; a real
analytics pipeline can land later if usage grows.

### 4.5 Scheduler interval = 1 hour
The expiring-soon scheduler doesn't need fine granularity — the
window is 7 days. Hourly keeps cost negligible.

### 4.6 No new payment provider abstraction
Saved-card off-session is Stripe-only. We don't add an off-session
path to `MockPaymentProvider` or the `PaymentGateway` interface;
the `OrdersService.checkout` branches on `savedPaymentMethodId`
present and calls Stripe directly via the existing
`StripePaymentProvider`. Mock-paid orders continue to use the
old path.

## 5. Acceptance criteria

- Buyer with a saved Visa hits `POST /orders/checkout` with
  `savedPaymentMethodId: <id>` and no carrier override → Stripe
  PaymentIntent created with `confirm=true,off_session=true`,
  order row written, webhook captures normally, order ends PAID.
- Same flow with Stripe test card `4000 0025 0000 3155`
  (requires SCA) → API returns 422 with PaymentIntent
  `client_secret`. Buyer-web reflows through
  `stripe.confirmCardPayment` → captures normally.
- `membership.subscription_invoice_paid` fires →
  `plus_renewed` email sent (visible in dev provider log).
  Re-deliver same webhook → already-idempotent at the listener
  layer, no second email.
- `membership.subscription_invoice_failed` → `plus_payment_failed`
  email sent, membership PAUSED (from Phase 23).
- `membership.subscription_deleted` → `plus_expired` email sent.
- Manually set a membership `autoRenew=false`,
  `currentPeriodEnd=now+3d`, run
  `POST /admin/plus/scan-expiring` → `plus_expiring_soon` email
  sent, MembershipBillingEvent(NOTICE_SENT) row written. Re-run
  → no second email.
- `/admin/plus` shows correct KPIs (verified against a seeded
  set of memberships) and recent billing events.
- `doc/phase-24-debug.md` captures decisions + limitations.
