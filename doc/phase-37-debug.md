# Phase 37 — Subscribe & Save — Debug Pass

> What shipped, the invariants, every endpoint, and the deferred follow-ons.

## What shipped

- **One model** (`ProductSubscription`) + one enum (`AutoshipStatus`).
- **`OrdersService.createSubscriptionOrder`** — a new, self-contained
  order-creation path: one seller, one variant, flat-rate shipping, the tax
  engine, standard commission, the 5% `SUBSCRIBE_SAVE` discount as a
  promotion line, inventory decrement, shipment row, and an **off-session**
  Stripe charge against the buyer's default saved card. Returns
  `{ ok, orderId, reason }`; never throws on a business failure. A failed
  charge cancels the stranded order and restores inventory.
- **`AutoshipService`** — subscribe, list, get, update (qty / interval /
  address), skip-next, pause, resume, cancel, and `processDue` (the
  scheduler core).
- **`AutoshipScheduler`** — hourly tick, gated by
  `AUTOSHIP_SCHEDULER_ENABLED=1`.
- **Dunning** — a failed run retries in 2 days; after 3 consecutive
  failures the subscription auto-pauses and the buyer gets a notification.
- **Frontend** — `SubscribeSave` block on the PDP (cadence picker +
  discounted price) and `/account/subscriptions` (skip / pause / resume /
  cancel + interval editor).

## Invariants

1. **Live, non-digital products only.** `subscribe` rejects digital products;
   `createSubscriptionOrder` fails cleanly (`product_inactive` /
   `digital_not_supported`) if the product later changes. The PDP block also
   hides for non-`NEW_GENUINE` conditions (refurb units are one-of-a-kind).
2. **`discountBps` is snapshotted** at creation — re-pricing the platform
   default never silently changes an existing subscription.
3. **The payment method is resolved per run** (`paymentMethods.defaultFor`);
   the address is stored on the subscription. No card → `no_payment_method`,
   no stranded order.
4. **A failed run leaves no stranded order** — `createSubscriptionOrder`
   cancels the order and restores `inventoryQty` before returning `ok:false`.
5. **Off-session must capture synchronously.** An intent that needs SCA
   (`authentication_required`) or doesn't capture is treated as a failure —
   the order is cancelled, not left half-paid.
6. **Three consecutive failures → `PAUSED`** + buyer notification. No
   infinite dunning.
7. **`CANCELLED` is terminal** — `cancel` sets `cancelledAt`; resume/skip/
   pause/update all reject a cancelled subscription.
8. **Skip consumes exactly one cycle** — `skipNextRun` is cleared on the tick
   that honours it, and `nextRunAt` still advances by `intervalDays`.
9. **`processDue` is idempotent-safe** — a subscription only advances once
   `nextRunAt` is reached; re-running the scan mid-cycle is a no-op.

## Endpoint inventory

| Method | Path | Auth |
|--------|------|------|
| POST | `/autoship` | JWT |
| GET  | `/autoship` | JWT |
| GET  | `/autoship/:id` | JWT |
| PATCH | `/autoship/:id` | JWT |
| POST | `/autoship/:id/skip` | JWT |
| POST | `/autoship/:id/pause` | JWT |
| POST | `/autoship/:id/resume` | JWT |
| POST | `/autoship/:id/cancel` | JWT |
| POST | `/admin/autoship/scan` | ADMIN (on-demand scan) |

## Schema additions

- `ProductSubscription` model.
- `AutoshipStatus` enum (`ACTIVE` / `PAUSED` / `CANCELLED`).
- `User.productSubscriptions`, `ProductVariant.subscriptions`,
  `Address.subscriptions` back-relations.

## Manual test list

1. **Subscribe.** PDP → Subscribe & Save → pick cadence → subscription appears
   under `/account/subscriptions`, `nextRunAt` = now + interval.
2. **Scan (no card).** `POST /admin/autoship/scan` with a due subscription and
   no saved card → run fails `no_payment_method`, `failureCount` 1,
   `nextRunAt` +2 days.
3. **Scan (success).** With Stripe test keys + a saved card → scan places a
   real order, charges off-session, `nextRunAt` advances a full interval,
   `failureCount` resets to 0.
4. **Skip.** Skip next → next scan records `SKIPPED`, advances a full
   interval, clears the flag.
5. **Pause / resume.** Pause → scan ignores it. Resume → `nextRunAt`
   recomputed to now + interval.
6. **Dunning.** Three failed scans → status `PAUSED`, buyer notified.
7. **Cancel.** Cancel → terminal; skip/pause/resume/update all 400.
8. **Stranded-order guard.** Force a payment failure → the created order is
   `CANCELLED` and the variant's `inventoryQty` is restored.

## Decisions worth highlighting

- **`createSubscriptionOrder` is a sibling of `checkout`, not a refactor of
  it.** Checkout is live, cart-coupled, and carries promotion / wallet /
  multi-seller / refurb / routing logic a single-variant subscription order
  doesn't need. A self-contained method is far lower-risk than surgery on the
  payment path — at the cost of ~60 duplicated lines, which the project's
  "no premature abstraction" rule explicitly prefers.
- **Card resolved per run, address stored.** The card rotates (expiry,
  replacement) and should always be the buyer's current default; the address
  is a deliberate choice and is pinned.
- **Off-session non-capture is a failure, not a pending state.** There is no
  buyer present to clear SCA on a scheduled run, so a non-captured intent is
  cancelled rather than parked.
- **5% flat discount, snapshotted.** Simple, predictable; recorded as a
  `SUBSCRIBE_SAVE` promotion line so the order math matches a promo order.

## Limitations / follow-ons

- **Needs Stripe test keys to actually charge** — off-session billing
  requires a saved card, which only the Stripe path provides. Without keys,
  runs fail `payment_failed` / `no_payment_method` (same constraint as
  gift-card purchase, Phase 35).
- **First variant only** — `SubscribeSave` subscribes to `variants[0]`; a
  multi-variant product can't yet be subscribed per-variant from the PDP.
- **No proration or mid-cycle interval recompute** — an interval change
  applies from the next successful run; `nextRunAt` is not retroactively
  shifted.
- **No seller/admin management UI** — admins get only the on-demand scan
  endpoint; there is no subscription dashboard.
- **No "subscription order" tagging** — autoship orders are normal orders;
  they are not linked back to the originating `ProductSubscription`.
