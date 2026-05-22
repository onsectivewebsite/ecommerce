# Phase 37 — Subscribe & Save

> Recurring auto-delivery of a product at a standing discount, charged
> off-session to the buyer's saved card on a buyer-chosen cadence.

## Goal

A shopper buying a consumable ("ship me this every 60 days") should not have
to re-checkout each time. They subscribe once; a scheduler creates the next
order automatically, charges their saved card off-session, and ships it. The
buyer manages cadence, quantity, skip-next, pause, and cancel themselves.
In exchange for the commitment, every subscription order carries a standing
discount (`SUBSCRIBE_SAVE_DISCOUNT_BPS`, default 5%).

## Data model

One model + one enum.

- **`ProductSubscription`** — `buyerUserId`, `variantId`, `qty`, `intervalDays`
  (30/60/90), `discountBps` (snapshotted at creation), `status`,
  `shippingAddressId`, `nextRunAt`, `lastRunAt`, `lastRunStatus`,
  `failureCount`, `skipNextRun`, `cancelledAt`, timestamps.
- **`AutoshipStatus`** — `ACTIVE` / `PAUSED` / `CANCELLED`.

The buyer's **default payment method is resolved at run time**, not stored on
the subscription — a card update or replacement is picked up automatically.
The shipping address *is* stored (the buyer chooses where it ships).

## Order creation

`OrdersService.createSubscriptionOrder` is a new, self-contained method —
the live cart-driven `checkout()` is untouched. It handles the simpler
subscription case: one seller, one variant, flat-rate shipping, the tax
engine, standard commission, the subscription discount recorded as a
`SUBSCRIBE_SAVE` promotion line, inventory decrement, shipment row, and an
**off-session** Stripe charge against the buyer's saved card. It returns a
result object (`{ ok, orderId, reason }`) rather than throwing, so the
scheduler can record per-run outcomes. On a payment failure it cancels the
stranded order and restores inventory.

## Scheduler

`AutoshipScheduler` — env-gated by `AUTOSHIP_SCHEDULER_ENABLED=1`, hourly
tick. For each `ACTIVE` subscription with `nextRunAt <= now`:

- **skip-next set** → clear the flag, advance `nextRunAt` by `intervalDays`,
  `lastRunStatus = SKIPPED`.
- **otherwise** → `createSubscriptionOrder`. On success: `failureCount = 0`,
  advance `nextRunAt` by `intervalDays`. On failure: `failureCount++`, retry
  in 2 days; after **3 consecutive failures** the subscription is `PAUSED`
  and the buyer is notified to fix their card / address.

## Invariants

1. **A subscription targets an `ACTIVE`, non-digital product variant.**
   Digital goods don't ship on a cadence; the run fails cleanly if a product
   is later deactivated.
2. **`discountBps` is snapshotted** at creation — a later change to the
   platform rate doesn't silently re-price an existing subscription.
3. **The default payment method is resolved per run.** No card → the run
   fails with `no_payment_method`, never a stranded uncharged order.
4. **A failed run never leaves a stranded order** — `createSubscriptionOrder`
   cancels the order and restores inventory before returning `ok: false`.
5. **Three consecutive failures pauses the subscription** — no infinite
   dunning; the buyer is notified.
6. **`CANCELLED` is terminal** — cancel sets `cancelledAt`; a cancelled
   subscription is never resumed (the buyer subscribes again instead).
7. **Skip affects exactly one cycle** — `skipNextRun` is consumed on the next
   tick and cleared.

## Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/autoship` | JWT | subscribe `{ variantId, qty, intervalDays, shippingAddressId }` |
| GET  | `/autoship` | JWT | my subscriptions |
| GET  | `/autoship/:id` | JWT | one subscription |
| PATCH | `/autoship/:id` | JWT | change qty / interval / address |
| POST | `/autoship/:id/skip` | JWT | skip the next cycle |
| POST | `/autoship/:id/pause` | JWT | pause |
| POST | `/autoship/:id/resume` | JWT | resume (recomputes `nextRunAt`) |
| POST | `/autoship/:id/cancel` | JWT | cancel (terminal) |

## Frontend

- **buyer-web** — a `SubscribeSave` block on the PDP: cadence picker, the
  discounted price, and a subscribe button (signed-in). `/account/subscriptions`
  lists the buyer's subscriptions with skip / pause / resume / cancel and an
  interval/quantity editor.

## Decisions

- **Self-contained `createSubscriptionOrder`** rather than refactoring
  `checkout()` — checkout is live, cart-coupled, and carries promotion /
  wallet / multi-item / refurb logic a subscription doesn't need. A sibling
  method is lower-risk than surgery on the payment path.
- **Resolve the card at run time, store the address.** The card is the thing
  that rotates (expiry, replacement); the address is the buyer's deliberate
  choice and should be stable.
- **2-day retry, pause after 3** — standard dunning. Avoids both giving up on
  one transient decline and hammering a dead card forever.
- **Stripe-only.** Off-session charging needs a saved card, which only the
  Stripe path provides — same constraint as gift-card purchase (Phase 35).
