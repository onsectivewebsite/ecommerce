# Phase 10 — Buyer Growth Engine

Date opened: 2026-05-18
Predecessor: Phase 9 (Marketplace Trust & Operations)

## 1. Why this phase

Phases 1–9 built the marketplace from foundation through trust & operations.
Every feature so far has been "buyer wants to buy → seller fulfills →
platform takes commission." Phase 10 adds the engagement loop that turns
visitors into repeat buyers and gives sellers the levers they expect from
modern commerce: **promotions, wallet/store-credit, wishlists, and
abandoned-cart recovery**.

These four are tightly coupled — promotions feed wallet (refund as credit),
wallet feeds abandoned-cart (incentivize completion), wishlists feed
price-drop alerts (re-engagement). Treating them as one phase avoids
shipping a half-engagement system.

## 2. Scope (in)

### 2.1 Promotions & Coupons
- Sellers create coupon codes against their own catalog: % off, flat-amount
  off, free shipping, BOGO (buy X get Y at Z% off).
- Admin creates platform-wide promos (e.g., signup bonus, holiday sitewide).
- Stacking rules: at most one seller code + at most one platform code.
- Per-user redemption cap + total redemption cap + active date window.
- Apply at checkout via `POST /cart/promotion`; pricing recalculated on the
  Cart preview so the UI sees the discount before order placement.
- Persisted on `Order.promotionCodes` and per-line on `OrderItem` so
  refunds / reports can attribute discount correctly.

### 2.2 Wallet & Store Credit
- Every user has a `WalletAccount` (lazy-created on first credit).
- `WalletTransaction` ledger: `CREDIT_GRANT`, `CREDIT_REFUND`,
  `DEBIT_CHECKOUT`, `DEBIT_REVERSAL`. Sum of transactions == balance
  (verified by a balance check on every write).
- Admin grants (signup bonus, makegood for incidents).
- `RefundMethod.STORE_CREDIT` (already in Phase 9 schema, never wired)
  becomes real: when a return is refunded as STORE_CREDIT, ReturnsService
  credits the buyer's wallet instead of calling the payment gateway.
- Buyer applies wallet balance at checkout. Order stores
  `walletAppliedMinor` for accounting.

### 2.3 Wishlists & Price-Drop Alerts
- Buyer maintains a wishlist (one per user; future-proofed for multi-list by
  using a `name` field — default list created lazily).
- Add/remove product to wishlist; share-by-token link.
- Watcher scheduler (cron, every 6h): for each wishlist item, compare the
  product's current price + stock against `snapshotPriceMinor` /
  `snapshotInStock`. On change in the buyer's favor (price ↓ or
  out-of-stock → in-stock), enqueue a push notification + update snapshot.

### 2.4 Abandoned Cart Recovery
- Scheduler scans `Cart` rows that have items, no recent `cartUpdatedAt`
  bump, and no order placed within the last 24h.
- Generates a recovery push and (eventually) email. First touch at 24h,
  second at 72h, then gives up.
- Per-cart "do not nudge" suppression after a buyer manually clears the
  cart or completes checkout.
- Optional: include a one-time 10%-off wallet credit on the second nudge to
  convert.

## 3. Scope (out)

- Loyalty points / tiered membership status (Bronze/Silver/Gold). Punted
  to a future phase — needs a sustained engagement model before it's
  worth the complexity.
- Gift cards (separate from wallet credit; involves SKU + activation
  flow + delivery — material work).
- Referral / affiliate codes that pay external influencers. Wallet supports
  the credit mechanic but the attribution/payout flow is a phase of its own.
- Tax-aware promotion logic at the line-item level. Treating promotions as
  pre-tax discounts only; tax engine sees discounted line totals.

## 4. Architectural decisions made up front

### 4.1 Promotion engine lives in `PromotionsService.evaluate(cart, codes)`
Returns `{ discountLines: [{ scope, amountMinor, reason }],
remainingFreeShipping: boolean }`. Called from `CartService.preview` so the
buyer always sees the realized discount before paying. The discount is NOT
materialized on the Cart row — recomputed on each preview so price/inventory
changes can't desync.

### 4.2 Wallet writes are double-entry-flavored
Every `WalletTransaction` row has a signed `amountMinor` (negative = debit)
and a `balanceAfterMinor` cached. On write, we re-read the prior balance
inside a `prisma.$transaction` and assert `priorBalance + amount ===
balanceAfterMinor`. This catches concurrent writes losing balance instead
of silently overwriting.

### 4.3 Wishlists store a snapshot, not a subscription
We don't subscribe to product change events. The price-drop watcher polls
on a schedule (6h granularity is fine for buyer-facing alerts). Reasoning:
products mutate frequently for irrelevant fields (descriptions, media),
and we don't want every catalog edit triggering a wishlist scan.

### 4.4 Abandoned cart suppression is by `Cart.id`, not by user
A buyer may have multiple carts in their history (especially with our
multi-seller model — though Phase 1 chose a single-cart model, mid-checkout
buyers can have a new cart row). Per-cart suppression avoids
"already-nudged buyer never gets nudged again."

## 5. Acceptance criteria

- Buyer sees promo code field on checkout, applies a code, total updates.
- Buyer can refund as STORE_CREDIT and see wallet balance reflect the
  credit; wallet credit shows up as a deduction on the next checkout.
- Seller can create / edit / disable a coupon from `/promotions`.
- Admin can grant wallet credit to any user with reason.
- Wishlist add from PDP works; price-drop push fires within 6h of a
  qualifying change.
- Abandoned cart push fires once 24h after the last cart update for a cart
  with non-zero items.
- `phase-10-debug.md` documents non-obvious decisions + post-build fixes.
