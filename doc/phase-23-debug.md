# Phase 23 — Debug Pass

Companion to `phase-23.md`. Decisions made, seams to watch, what to
test before merging.

## 1. The invariants Phase 23 preserves

1. **Stripe is the source of truth for subscription state.**
   The local `PlusMembership` row mirrors fields from the
   subscription — `currentPeriodEnd`, `autoRenew`, status — but no
   non-webhook code path updates them after `start()`. This keeps
   reads cheap without inviting drift.
2. **Webhook handlers are idempotent on `providerEventId`.**
   `MembershipBillingEvent.providerEventId` is a unique constraint;
   the listener catches P2002 violations as a normal no-op so
   Stripe's webhook re-delivery doesn't double-renew a term.
3. **Lazy expiry stays.** If a webhook is dropped or the local row
   drifts, `MembershipService.getForUser` still flips ACTIVE→EXPIRED
   when `expiresAt < now`. Benefits never extend past their stored
   end date.
4. **The default-card guarantee.** The only ACTIVE card can't be
   detached while Plus is on auto-renew — that would brick the next
   charge. The buyer has to either disable auto-renew or add a
   second card first.

## 2. Non-obvious decisions

### 2.1 Stripe customer id lives on PaymentMethod, not User
We didn't want to add a column to the auth-hot User table.
`ensureCustomer(userId)` looks for any existing PaymentMethod row
(`findFirst`) and reuses its `providerCustomerId`; if none, it
creates a Stripe customer and the first attach stamps it. One
extra read per pre-card flow, no schema cost on User.

### 2.2 PAUSED is stored, not derived
Stripe goes `past_due` when an invoice fails. We mirror that as
status `PAUSED` so all benefit gates
(`MembershipService.isActiveForUser` and its callers in checkout)
keep their single check: `status === ACTIVE && expiresAt > now`.
A derived check would have required every gate to know about
subscription state.

### 2.3 cancel = at-period-end only
`MembershipService.cancel` calls
`stripe.subscriptions.update(id, { cancel_at_period_end: true })`
and sets `autoRenew=false`. It does NOT flip status to
CANCELLED — Stripe emits `customer.subscription.deleted` when the
period actually closes, and the webhook listener writes
`status=EXPIRED` then. This matches the buyer-facing language
("benefits last through the paid term"). Legacy Phase-22 rows
without a `providerSubscriptionId` are flipped to CANCELLED
immediately because there's no webhook coming.

### 2.4 No re-creation path on re-enable
`setAutoRenew(true)` calls
`stripe.subscriptions.update(id, { cancel_at_period_end: false })`.
This only works as long as the subscription hasn't been deleted
yet — i.e., the buyer is between "cancelled" and the term ending.
After the deletion webhook fires, the row is EXPIRED and the buyer
takes the normal `/loyalty/membership` POST path which creates a
fresh subscription. The UI hides the "Re-enable" button once
status is EXPIRED.

### 2.5 Payments emits domain events, loyalty consumes
`PaymentsService.handleWebhook` doesn't import the loyalty schema
or call MembershipService. It just emits
`membership.subscription_*` events with the small payload shape
the listener needs. Stripe types stay in payments; membership row
mutations stay in loyalty.

### 2.6 SetupIntent over PaymentMethod attach directly
We use a SetupIntent because the attach can trigger 3DS step-up
client-side via Stripe Elements. On confirm, our server resolves
the SetupIntent to get the canonical `customerId` and
`paymentMethodId`, then mirrors brand/last4/exp from the resolved
PaymentMethod object. We refuse if the resolved customer doesn't
match the user's customer id (defense against someone confirming
a setup intent on another account's behalf).

### 2.7 Default promotion is automatic on first attach
The first ACTIVE card a user attaches is promoted to default both
locally AND on Stripe (`customers.update`). Detaching the default
promotes the most recently-added remaining ACTIVE card. No UI
needed for the most common case.

### 2.8 Mock provider unaffected
`MockPaymentProvider` still exists for one-shot order payments in
dev/test. Subscriptions only run through Stripe — there is no
mock subscription provider, because dev can hit Stripe in test
mode with `LOYALTY_STRIPE_PRICE_*` test price ids and the local
`/payments/webhook/stripe` route forwarded via the Stripe CLI.

### 2.9 No proration on plan switch
Spec calls out: switch = cancel current + start new. We don't
proration-compute the gap. Acceptable because the difference
between $9.99 and $79 is small enough that a buyer who wants to
switch is just going to wait out the current term. The renewal-UX
phase can add proration if real usage demands it.

## 3. Things to test end-to-end

Stripe CLI prerequisite:
```
stripe listen --forward-to localhost:4000/payments/webhook/stripe
```

- `POST /payment-methods/setup-intent` → `clientSecret` returned.
  Stripe Elements confirm with test card `4242 4242 4242 4242`
  succeeds. `POST /payment-methods/attach { setupIntentId }` →
  row written with brand=`visa`, last4=`4242`, isDefault=true.
- Add a second card → first stays default. `POST /payment-methods/:id/default`
  on the second → first flips off, second on; Stripe customer's
  `invoice_settings.default_payment_method` updates.
- `DELETE /payment-methods/:id` on the only card while Plus is
  ACTIVE → 400 "Cannot remove your only card while Plus auto-renew
  is on". Disable auto-renew → DELETE succeeds.
- `POST /loyalty/membership { plan: 'PLUS_ANNUAL' }` with no
  default card → 400 "Add a payment method before joining Plus".
  With a default card → subscription created on Stripe, local row
  written with `providerSubscriptionId`, `currentPeriodEnd` set
  from Stripe, status ACTIVE, autoRenew true.
- Trigger `stripe trigger invoice.paid` against the Plus
  subscription → MembershipBillingEvent(INVOICE_PAID) row, local
  membership `expiresAt` + `renewedAt` updated. Re-deliver same
  event → no duplicate row (P2002 swallowed).
- `stripe trigger invoice.payment_failed` →
  MembershipBillingEvent(INVOICE_FAILED), status PAUSED. Buyer
  sees "Paused — payment failed" on `/account/membership` and free
  shipping stops at checkout.
- `POST /loyalty/membership/cancel` → Stripe sub updates with
  cancel_at_period_end=true. Local row `autoRenew=false`,
  `cancelledAt` set, status stays ACTIVE. Benefits continue.
- `POST /loyalty/membership/auto-renew { autoRenew: true }` →
  Stripe sub updates with cancel_at_period_end=false; local
  `autoRenew=true`, `cancelledAt` cleared.
- Let the term lapse (or force `stripe trigger
  customer.subscription.deleted`) → MembershipBillingEvent(SUB_DELETED),
  status EXPIRED, benefits stop, lazy-expiry path agrees.
- Webhook re-delivery for any of the four event types → no
  duplicate row, no double-state-mutation.
- `/account/payment-methods` Stripe Elements add-card flow works
  end-to-end with `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` set;
  missing key shows the inline notice rather than crashing.
- `/account/membership` shows next renewal date, default card
  line, auto-renew toggle. PAUSED state surfaces "update your card"
  copy.

## 4. Known limitations

- **3DS on subscription renewal** — Stripe handles SCA on the
  attach flow via SetupIntent. If a renewal payment requires
  fresh SCA (e.g., regulatory step-up), the renewal will hit
  `invoice.payment_failed` and we flip to PAUSED. The buyer must
  re-add the card. A future phase could deep-link to a Stripe-hosted
  authentication URL we get back via `invoice.payment_intent`.
- **No proration on plan switch** (covered in §2.9).
- **No retry strategy override** — we use Stripe's default
  smart-retries. If a card recovers on Stripe's retry clock, the
  `invoice.paid` webhook flips us back to ACTIVE automatically.
- **No notification on renewal or PAUSED** — the buyer learns by
  visiting `/account/membership`. Hooking into the Phase 12
  notifications module is a one-line follow-up.
- **No Apple Pay / Google Pay** — `CardElement` only. The
  PaymentElement would cover wallets but is a slightly different
  Elements API; deferred.
- **No grace period beyond Stripe's retries** — if Stripe gives
  up, the subscription is `canceled` and we mark EXPIRED.
- **Plus chip in TopBar still fetches per page-load** — same
  caching opportunity as Phase 22.
- **Webhook secret presence is checked lazily** — if a Stripe
  webhook arrives without `STRIPE_WEBHOOK_SECRET` set, the
  provider throws. That's fine for dev (loud failure) but a real
  deploy needs the secret set or the route will 500 on every
  delivery.

## 5. Files added

- `services/api/src/modules/payments/payment-methods.service.ts`
- `services/api/src/modules/payments/payment-methods.controller.ts`
- `services/api/src/modules/loyalty/membership-billing.listener.ts`
- `packages/api-client/src/endpoints/payment-methods.ts`
- `apps/buyer-web/src/app/account/payment-methods/page.tsx`

## 6. Files edited

- `services/api/prisma/schema.prisma` — `PaymentMethod`,
  `MembershipBillingEvent`, `PlusMembership.providerSubscriptionId`
  / `autoRenew` / `currentPeriodEnd`, `User.paymentMethods`
  back-relation, two new enums.
- `services/api/src/modules/payments/payments.module.ts` —
  registered `PaymentMethodsService` + controller, made module
  `@Global`, exported `PaymentMethodsService` +
  `StripePaymentProvider`.
- `services/api/src/modules/payments/payments.service.ts` —
  webhook handler emits `membership.subscription_*` events
  ahead of the Payment-row lookup branch.
- `services/api/src/modules/payments/stripe.provider.ts` —
  customer/setup-intent/subscription helpers, four new webhook
  event mappings.
- `services/api/src/modules/payments/gateway.ts` — extended
  `PaymentWebhookEvent` with subscription-event types + the
  Phase-23 metadata fields.
- `services/api/src/modules/loyalty/membership.service.ts` —
  start now drives Stripe Subscription create, cancel = at-period-end,
  added `setAutoRenew` + `getBySubscriptionId`.
- `services/api/src/modules/loyalty/loyalty.controller.ts` +
  `dto.ts` — added `POST /loyalty/membership/auto-renew`, dropped
  `paymentRef` from `StartMembershipDto`.
- `services/api/src/modules/loyalty/loyalty.module.ts` —
  registered `MembershipBillingListener`.
- `packages/api-client/src/index.ts` + `endpoints/loyalty.ts` —
  added `setAutoRenew`, dropped `paymentRef`, new fields on
  `PlusMembership`. Exported new `PaymentMethodsApi`.
- `apps/buyer-web/package.json` — added
  `@stripe/react-stripe-js` + `@stripe/stripe-js`.
- `apps/buyer-web/src/lib/env.ts` — `STRIPE_PUBLISHABLE_KEY`.
- `apps/buyer-web/src/lib/api.ts` — wired `PaymentMethodsApi`.
- `apps/buyer-web/src/app/account/page.tsx` — added
  "Payment methods" link.
- `apps/buyer-web/src/app/account/membership/page.tsx` —
  card-required guard, default-card display, auto-renew toggle,
  PAUSED copy, dropped mock paymentRef.

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_23_recurring
pnpm -r typecheck
pnpm -r build
```

Required env (no defaults — Stripe-only):

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
LOYALTY_STRIPE_PRICE_ANNUAL=price_...      # $79/yr recurring price id
LOYALTY_STRIPE_PRICE_MONTHLY=price_...     # $9.99/mo recurring price id
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

The migration adds two new enums (`PaymentMethodStatus`,
`MembershipBillingEventKind`), two new tables (`PaymentMethod`,
`MembershipBillingEvent`), three nullable columns on
`PlusMembership`, and one new back-relation on `User`. No backfill
needed — Phase-22 memberships keep `providerSubscriptionId=null`,
`autoRenew=true`, and `currentPeriodEnd=null` until they're either
renewed via the new flow or expire by lazy-expiry.
