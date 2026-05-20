# Phase 24 — Debug Pass

Companion to `phase-24.md`. Decisions made, seams to watch, what to
test before merging.

## 1. The invariants Phase 24 preserves

1. **Saved-card checkout reuses Phase 23 PaymentMethod rows.** No
   parallel state — the same row that pays for Plus renewals is
   the row that pays for orders.
2. **3DS step-up is reflowed via the existing PaymentIntent.**
   When Stripe demands SCA on an off-session attempt, the API
   returns the PaymentIntent's `client_secret` with code
   `PAYMENT_AUTHENTICATION_REQUIRED`. The buyer-web confirms it
   client-side via `confirmCardPayment` and the existing
   `payment_intent.succeeded` webhook captures the order. No new
   server flow.
3. **Notification listeners and the membership-state listener are
   independent.** Both subscribe to the same `membership.subscription_*`
   events. An email failure does not roll back a status update, and
   a status update doesn't depend on an email going out.
4. **Expiring-soon reminders are once-per-term.** The synthetic
   `providerEventId` is `reminder:<membershipId>:<currentPeriodEnd-iso>`
   on a `MembershipBillingEvent(NOTICE_SENT)` row. A second
   scheduler tick this term hits the unique constraint and is a
   no-op.
5. **Admin KPIs are derived, not cached.** `mrrMinor`,
   `activeCount`, etc. come from indexed queries on `PlusMembership`
   (`status`, `expiresAt`, `cancelledAt`, `startedAt`). N is small,
   re-derivation is cheap.

## 2. Non-obvious decisions

### 2.1 Off-session capture happens at order create
We don't separate "create order" from "charge the saved card."
The PaymentIntent is created with `confirm=true, off_session=true`
in the same call that writes the Payment row. If Stripe captures
synchronously, we mark the order PAID locally AND emit
`order.paid` — the subsequent webhook is idempotent (the existing
handler only flips if `payment.status !== CAPTURED`). The
trade-off is that a buyer waits an extra second on the synchronous
capture; the benefit is no "pending" state to clean up.

### 2.2 SCA reflow via ApiError.details
We pack `{ clientSecret, order }` into the existing
`ApiErrorBody.details` field and a custom `code` string. The
buyer-web inspects `err.code === 'PAYMENT_AUTHENTICATION_REQUIRED'`
and reads `err.details.clientSecret`. This avoids extending the
ApiError contract or inventing a new error class — `details` was
always a `unknown` escape hatch.

### 2.3 Saved-card-only on Stripe
The off-session flow is Stripe-only. If a buyer tries to use a
saved card with the mock provider we 400. We did not add an
off-session path to `PaymentGateway` itself — Mock has no concept
of a stored card and Razorpay/PayPal aren't wired for saved
cards. Future providers can opt in by extending the gateway
interface if they support it.

### 2.4 PlusNotificationsListener is separate from MembershipBillingListener
We considered emitting the email from inside the billing listener.
We kept them apart because: (a) email failures shouldn't taint
state-mutation idempotency, (b) the email scope reads from the
membership row AFTER it's been updated, which means it would
have to live downstream of the mutation in the same handler
otherwise — fragile sequencing. Two listeners on the same event,
each does one thing, fits the project pattern.

### 2.5 NOTICE_SENT lives on MembershipBillingEvent
We added a new kind on the existing audit-log table rather than
creating a `MembershipReminderSent` table. Reason: the table is
already "things that happened to this membership over time"; a
reminder fits that shape. The synthesized `providerEventId`
collides with future real Stripe event ids on neither namespace
(`reminder:` vs `evt_`).

### 2.6 Expiring-soon scheduler is opt-in
Gated by `LOYALTY_EXPIRING_SCHEDULER_ENABLED=1`. In dev/CI the
scheduler stays off; ops can flip it on per-env or call
`POST /admin/plus/scan-expiring` manually. Mirrors the
`SLA_SCHEDULER_ENABLED` gate from Phase 21.

### 2.7 MRR is monthly-equivalent
We collapse annual subs into a monthly cell by dividing by 12.
This is a standard SaaS convention for an "MRR" headline number;
real finance reporting would use ARR (or both). Ops needs one
number; we give them the conventional one.

### 2.8 Manual fallback for the scheduler
The admin page has a "Scan expiring soon" button that calls
`POST /admin/plus/scan-expiring`. Lets ops run it on demand
when investigating reports of missing reminders, without
shelling into the API host.

### 2.9 No notification preference plumbing needed
The four new email categories (`plus_renewed`,
`plus_payment_failed`, `plus_expiring_soon`, `plus_expired`)
plug into the existing `NotificationPreference.prefs[category]`
opt-out. Buyers who already have a per-category preference UI
get Plus categories for free; default is on.

## 3. Things to test end-to-end

Stripe CLI prerequisite:
```
stripe listen --forward-to localhost:4000/payments/webhook/stripe
```

- Buyer with one saved Visa hits `/checkout`, selects it, places
  order → PaymentIntent created with confirm+off_session, order
  goes PAID, `order.paid` emitted (loyalty points + sustainability
  + email all fire from existing listeners).
- Saved-card checkout with Stripe test card
  `4000 0025 0000 3155` (SCA required) → API returns 409 with
  `code: PAYMENT_AUTHENTICATION_REQUIRED`. Buyer-web reflows
  through `confirmCardPayment` → succeeds. Webhook captures.
- `stripe trigger invoice.paid` for a Plus sub →
  `plus_renewed` email sent (dev provider log shows it),
  MembershipBillingEvent(INVOICE_PAID) row written. Re-deliver
  → no duplicate billing event, no second email (the renewal
  email isn't deduped at the listener layer — the state listener
  is — but the second event fires the listener again; this is
  fine because the email category itself doesn't dedupe.
  Acceptable: re-delivery is rare and a duplicate renewal email
  is friendlier than a missed one).
- `stripe trigger invoice.payment_failed` →
  `plus_payment_failed` email sent, membership PAUSED.
- `stripe trigger customer.subscription.deleted` →
  `plus_expired` email sent, status EXPIRED.
- Seed an ACTIVE membership with `autoRenew=false` and
  `expiresAt=now+3d`. Hit `POST /admin/plus/scan-expiring` →
  response `{ scanned: 1, emailed: 1, skippedAlreadySent: 0 }`,
  `plus_expiring_soon` email sent. Re-run → `{ scanned: 1,
  emailed: 0, skippedAlreadySent: 1 }`.
- Re-seed the buyer's membership with a fresh
  `currentPeriodEnd` (simulating renewal) → next scan emails
  again because the reminder key includes the period-end ISO.
- `/admin/plus` renders KPIs against a seeded set:
  N active, X paused, MRR sum correct (annual ÷ 12 + monthly),
  30-day windows correct.
- `/admin/plus` filter by event kind narrows the table; "All"
  re-fetches with limit 100.

## 4. Known limitations

- **Renewal email is not deduped per webhook re-delivery.**
  The billing-state listener is idempotent (state) but the
  notifications listener fires on every event. Stripe's webhook
  re-delivery is rare; the trade-off is no missed renewal email.
  A future polish pass can dedupe by writing a NOTICE_SENT row
  for each emailed kind.
- **No SMS / no push.** Email only. Existing
  `NotificationsService` push could be wired but mobile parity
  for Plus isn't shipped yet.
- **3DS reflow uses CardElement implicitly.** `confirmCardPayment`
  with only a clientSecret triggers Stripe's own modal. No
  control over the styling. Acceptable.
- **MRR doesn't account for prorations, refunds, or discounts.**
  Headline figure only.
- **Churn window is calendar-30-days from now, not a fixed
  month.** Numbers will move daily.
- **Scheduler interval is hourly.** A 7-day window is generous
  enough that a missed tick is fine.
- **No admin "force-send reminder" override.** If ops wants to
  re-email a specific buyer they have to delete the NOTICE_SENT
  row manually. Acceptable for Phase 24.

## 5. Files added

- `services/api/src/modules/loyalty/plus-notifications.listener.ts`
- `services/api/src/modules/loyalty/plus-expiring-soon.scheduler.ts`
- `services/api/src/modules/loyalty/plus-admin.service.ts`
- `services/api/src/modules/loyalty/plus-admin.controller.ts`
- `packages/api-client/src/endpoints/plus-admin.ts`
- `apps/admin-web/src/app/plus/page.tsx`

## 6. Files edited

- `services/api/prisma/schema.prisma` — added `NOTICE_SENT` to
  `MembershipBillingEventKind`.
- `services/api/src/modules/payments/gateway.ts` —
  `savedPaymentMethodId/savedPaymentCustomerId` on
  `PaymentIntentInput`, `capturedOffSession` on result,
  `PaymentAuthenticationRequiredError`.
- `services/api/src/modules/payments/stripe.provider.ts` —
  off-session capture path with SCA error mapping.
- `services/api/src/modules/orders/orders.service.ts` —
  routes saved-card checkout, returns SCA reflow payload via
  `ConflictException.details`, captures PAID synchronously on
  off-session success.
- `services/api/src/modules/orders/dto.ts` —
  `savedPaymentMethodId` on `CheckoutDto`.
- `services/api/src/modules/email/templates.ts` — four new
  templates: `plus_renewed`, `plus_payment_failed`,
  `plus_expiring_soon`, `plus_expired`.
- `services/api/src/modules/loyalty/loyalty.module.ts` —
  registered listener, scheduler, admin service + controller.
- `packages/shared-types/src/dto/orders.ts` —
  `savedPaymentMethodId` on `CheckoutRequest`.
- `packages/api-client/src/index.ts` — re-export `plus-admin`.
- `apps/buyer-web/src/app/checkout/page.tsx` — saved-card
  selector, SCA reflow with `confirmCardPayment`.
- `apps/admin-web/src/lib/api.ts` — wired `PlusAdminApi`.
- `apps/admin-web/src/components/Shell.tsx` — added `/plus` to
  side-nav.

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_24_plus_ops
pnpm -r typecheck
pnpm -r build
```

Required env on top of Phase 23:

```
LOYALTY_EXPIRING_SCHEDULER_ENABLED=1       # turn on the hourly tick
LOYALTY_EXPIRING_SOON_DAYS=7               # default window
BUYER_WEB_URL=https://app.onsective.com    # used to build email deep links
```

The migration adds one enum value (`NOTICE_SENT`) — no new tables,
columns, or backfill required.
