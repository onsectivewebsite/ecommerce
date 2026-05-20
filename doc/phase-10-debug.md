# Phase 10 — Debug & Wire-Up Notes

Date: 2026-05-18

Phase 10 introduced four buyer-engagement modules (Promotions, Wallet,
Wishlists, AbandonedCart) plus checkout integration. This doc captures
non-obvious design decisions made during the build and issues caught during
the post-build inspection.

---

## 1. Design decisions captured during the build

### 1.1 Promotion engine is stateless at the cart level
Discounts are NOT materialized onto `Cart` rows. `PromotionsService.evaluate`
is called from `OrdersService.checkout` (and could be called from a future
`/cart/preview` endpoint) on every invocation. Rationale: cart-stored
discounts go stale the moment a product changes price or stock, and we'd
need an invalidation hook on every catalog write. Recomputing on each
preview costs one extra query and is bulletproof.

Persistence only happens at order placement:
- `Order.promotionLines` JSON snapshot of the applied codes (for refunds,
  customer-service explanations, accounting reports).
- `PromotionRedemption` rows for per-user + lifetime cap enforcement.

### 1.2 Stacking: 1 seller + 1 platform code, max
We deliberately do NOT support arbitrary code stacking. The first valid
SELLER-scope code in the input list wins; the first valid PLATFORM-scope
code wins. Everything else is dropped silently. Reasons:
- Bounded UX: buyers don't enter 5 codes hoping one works.
- Bounded math: BOGO + percent-off + percent-off triple stacks are a known
  source of negative-revenue bugs in real marketplaces.
- A unified discount story for accounting (one seller share, one platform
  share, both attributable).

### 1.3 Commission base excludes seller-funded discounts only
When a seller-issued code reduces the price, the seller's commission base
shrinks. When a PLATFORM-funded promo reduces the buyer's price, the
seller is paid as if the promo never existed — the platform absorbs the
discount. This matches every mature marketplace's policy and keeps sellers
willing to honor platform-wide promos without complaint.

```
commissionBase = subtotalMinor - sellerDiscountMinor  (NOT minus platformDiscountMinor)
```

### 1.4 Wallet uses asserted balance writes inside a transaction
Every `applyDelta` re-reads the wallet inside `prisma.$transaction`, computes
`balanceAfterMinor`, writes the txn row, patches the wallet, and re-reads
the patched balance to assert the math is consistent. This protects against
two concurrent debits both reading balance=100 and each subtracting 50,
leaving 50 instead of the correct 0.

A negative final balance throws — wallet cannot go negative even with the
race assertion in place.

### 1.5 STORE_CREDIT refund bypasses the payment gateway
`Return.refundMethod` was already `STORE_CREDIT | ORIGINAL | MANUAL` in
Phase 9 but only `ORIGINAL` was wired. Phase 10 closes the loop:
`ReturnsService.runRefund` branches on `refundMethod`. STORE_CREDIT calls
`WalletService.creditAsRefund` instead of `PaymentsService.refundOrder`. The
`refundProviderRef` column stores `wallet:<new-balance>` so the audit trail
distinguishes the two paths.

This also means a STORE_CREDIT refund never reverses commission via
`CommissionBooker.onRefunded` (which listens for `order.refunded` from the
gateway path). That's intentional — the seller already shipped the item and
got paid; the platform absorbs the credit balance as a future-revenue offset.
If accounting wants a stricter view we'd emit a separate event, but for the
buyer-engagement scope this is correct.

### 1.6 Wishlist watcher polls, doesn't subscribe
The watcher reads up to 5000 wishlist items, compares each item's snapshot
against the live product, and updates snapshots. There is no event-driven
push. Reasons:
- Wishlist watching is buyer-facing — a 6-hour lag is acceptable.
- Catalog mutations are noisy (description / media edits, tax flag
  toggles) — wiring an event listener would force us to either filter at
  the listener level or push spurious wishlist queries on every product
  edit.
- The watcher can scan 5000 items in well under a second; we'll add paging
  when wishlist counts justify it.

### 1.7 Cart recovery is opt-in per environment
Two env vars gate the feature:
- `CART_RECOVERY_ENABLED=1` turns on the scheduler.
- `CART_RECOVERY_INCENTIVE=1` allows the 72h nudge to drop a $5 wallet
  credit. Without it, the 72h nudge is purely a reminder.

This avoids accidental wallet bleed in dev / staging. Production turns
both on after a fraud-review pass.

---

## 2. Issues caught during the inspection pass

### 2.1 `CheckoutDto` was missing previously-undeclared fields
`OrdersService.checkout` already referenced `dto.shippingCarrier`,
`dto.shippingService`, and `dto.shippingAmountMinor` — those were declared
on `CheckoutRequest` in `@onsective/shared-types` but had been omitted from
the API's class-validator DTO since Phase 2. Phase 10 added them properly
so the new `promotionCodes` and `walletAmountMinor` fields don't trigger a
"strip whitelist" surprise. Net effect: more validation, no behavior change
for older fields.

### 2.2 `OrderDto` did not expose discount or wallet attribution
Added optional `walletAppliedMinor` and `promotionLines` fields to
`OrderDto` and populated them in `OrdersService.toDto`. Marked optional so
existing consumers (mobile app, older clients) still type-check.

### 2.3 `CommissionMinor` was being computed on the gross subtotal
Before Phase 10 it was `Math.round((subtotalMinor * commissionBps) / 10000)`.
With seller-funded discounts this overcharges the seller — they're paying
commission on revenue they never collected. New behavior subtracts only
seller-scope discounts before computing commission. Platform-scope
discounts are absorbed by the platform and DO NOT reduce commission.

### 2.4 Promotion code normalization
Codes are normalized to UPPER-snake on create + on evaluate. The frontend
upper-cases as the buyer types, but server-side normalization is still the
authoritative gate.

### 2.5 Wallet credit + order rollback ordering
Wallet debit and promotion-redemption recording happen AFTER the order's
`prisma.$transaction` commits, not inside it. If the wallet debit fails the
order is still placed — the alternative (rolling back the order because the
wallet write hiccupped) is worse UX. The failure is logged and on-call can
reverse-debit manually. Promo redemption inserts are wrapped in try/catch
because the `(promotionId, orderId)` unique constraint means re-running
the post-order flow is safe.

### 2.6 Wishlist `runWatcher` writes snapshots even when no notification
fired
On every pass we also drift the snapshot if the buyer's perceived
price/stock changed in any direction. This prevents the "price went up
then back down" attack where the snapshot never updates and the buyer gets
spammed on the way down. Trade-off: chatty writes, but each is a single-row
update keyed by ID — cheap.

### 2.7 Cart suppression on checkout commit
Inside the same `prisma.$transaction` that creates the Order, we also set
`recoverySuppressedAt = now()` on the cart. Otherwise the recovery
scheduler would see "cart with items? no — but cart age > 24h, suppress
flag not set" and might re-attempt to send a nudge if the cart row hangs
around. The empty `CartItem.deleteMany` plus the suppression flag makes
the cart definitively dead for nudge purposes.

### 2.8 Stripe webhook unaffected
Phase 10 does not change payment flow — promotions discount the captured
amount upstream, the wallet apply reduces the captured amount upstream,
the gateway only sees `totalMinor` as it has always done. No webhook
changes required.

---

## 3. Wire-up checklist

- `app.module.ts`: `PromotionsModule`, `WalletModule`, `WishlistsModule`,
  `AbandonedCartModule` registered. Wallet + Promotions are `@Global` so
  `OrdersService` + `ReturnsService` can inject them without import gymnastics.
- `OrdersService` constructor now takes `PromotionsService` + `WalletService`.
- `ReturnsService` constructor now takes `WalletService` and branches on
  `Return.refundMethod` in `runRefund`.
- New endpoints (`PromotionsApi`, `WalletApi`, `WishlistsApi`) exported
  from `@onsective/api-client/index.ts`.
- Each portal's `api.ts` registers the new endpoint classes. Admin gets
  Wallet + Promotions, seller gets Promotions, buyer gets all three.
- Buyer pages: `/account/wishlist`, `/account/wallet`, wishlist heart on
  PDP, promo + wallet UI in checkout summary. `/account` page links updated.
- Seller pages: `/promotions` (CRUD + pause/activate). Nav updated.
- Admin pages: `/promotions` (read-only view), `/wallet` (grant credit). Nav
  updated.

## 4. Operational notes

- **`SUPPORT_SELLER_SLA_HOURS`** — already defined in Phase 9.
- **`WISHLIST_WATCHER=1`** — opt in to the 6-hour watcher in production.
- **`CART_RECOVERY_ENABLED=1`** — opt in to the hourly recovery scan.
- **`CART_RECOVERY_INCENTIVE=1`** — additionally enables a $5 wallet
  credit on the 72h nudge. Off by default; enable after fraud-review.

## 5. Things deliberately out of scope

- Coupon stacking beyond 1 seller + 1 platform code.
- Tax-aware per-line discount allocation (we treat promos as pre-tax order-
  level discounts; tax sees the discounted subtotal).
- Multi-wishlist per user (schema is ready via `Wishlist.name`, UI ships a
  single "Default" list).
- Email recovery channel (push only — email worker arrives with the
  transactional email service in a future phase).
- Loyalty points, tiers, referral attribution. See `doc/phase-10.md` for
  the deferred-list reasoning.
