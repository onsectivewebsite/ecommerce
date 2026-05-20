# Phase 35 — Gift Cards & Store Credit — Debug Pass

> What shipped, the invariants, every endpoint, and the deferred follow-ons.

## What shipped

- **One new model** (`GiftCard`) + one new `WalletTxnKind` (`CREDIT_GIFT_CARD`). Redemption reuses the Phase-9 wallet ledger as the system of record — no separate redemption table.
- **Purchase** via a real Stripe PaymentIntent. `GiftCardsService.purchase` creates a `PENDING_PAYMENT` card, opens an intent stamped with `giftCardId` metadata, and returns the `clientSecret` for the buyer to confirm with Stripe.js.
- **Webhook routing.** `PaymentsService.handleWebhook` gets an early branch: any captured/failed intent carrying `giftCardId` emits `giftcard.purchase.paid` / `giftcard.purchase.failed` and returns before the order-keyed `Payment` lookup. `GiftCardsListener` applies the state change.
- **Delivery.** On capture, the purchase listener delivers immediately (or leaves a future-dated card for the hourly `GiftCardsScheduler`, env-gated `GIFTCARD_SCHEDULER_ENABLED=1`). The recipient gets `gift_card_received`; the purchaser gets `gift_card_purchase_receipt`.
- **Redemption.** `redeem` transfers the full remaining balance into the redeemer's wallet as a `CREDIT_GIFT_CARD` entry and flips the card to `REDEEMED`. `check` previews status + balance without mutating.
- **Admin.** Issue promotional cards (no payment, instantly `ACTIVE`), void unredeemed cards, list/search.
- **Frontend.** buyer-web `/gift-cards` (purchase with Stripe Elements), `/account/gift-cards` (redeem + sent-cards list), admin-web `/gift-cards` (issue/void/search). TopBar gets a "Gift cards" link.

## Invariants

1. **Exactly one of `orderId` / `giftCardId`** is stamped into a PaymentIntent's metadata. `intentMetadata()` in the Stripe provider enforces it; the webhook routes on whichever is present.
2. **A card is delivered at most once.** `deliver()` is idempotent — it no-ops if `deliveredAt` is set or status isn't `ACTIVE`.
3. **A card is redeemed at most once.** `redeem()` claims the card with a conditional `updateMany({ where: { id, status: 'ACTIVE' } })`; a losing concurrent caller sees `count === 0` and bails *before* any wallet credit. If the subsequent wallet write throws, the claim is rolled back so the card is redeemable again.
4. **`markPaid` / `markFailed` are idempotent** — they no-op unless the card is still `PENDING_PAYMENT`, so a duplicated Stripe webhook can't double-activate or email twice.
5. **Balance conservation.** `balanceMinor` equals `initialAmountMinor` until redemption, then `0`. Voiding also zeroes it. There is no partial-redemption path, so the balance is always all-or-nothing.
6. **No expiry on paid cards.** Buyer-purchased cards have `expiresAt = null` (US CARD Act / EU compliance). Only admin-issued promo cards may carry a future `expiresAt`; lazy expiry flips them to `EXPIRED` on read.
7. **Redeemed cards can't be voided.** `adminVoid` refuses `REDEEMED` (the balance already left the card).

## Endpoint inventory

| Method | Path | Auth | Rate limit |
|--------|------|------|------------|
| POST | `/gift-cards/purchase` | JWT | `giftcard.purchase` 10/3600s user |
| GET  | `/gift-cards/check` | JWT | — |
| POST | `/gift-cards/redeem` | JWT | `giftcard.redeem` 10/3600s user |
| GET  | `/gift-cards/mine` | JWT | — |
| GET  | `/admin/gift-cards` | ADMIN | — |
| POST | `/admin/gift-cards/issue` | ADMIN | — |
| POST | `/admin/gift-cards/:id/void` | ADMIN | — |
| POST | `/admin/gift-cards/deliver-due` | ADMIN | — (dev scan) |

## Schema additions

- `GiftCard` model + `GiftCardStatus` enum (`PENDING_PAYMENT → ACTIVE → REDEEMED`, plus `VOID` / `EXPIRED`).
- `WalletTxnKind.CREDIT_GIFT_CARD`.
- `User.giftCardsPurchased` / `User.giftCardsRedeemed` back-relations.
- Payment plumbing: `PaymentIntentInput.orderId` made optional + `giftCardId` added; `PaymentWebhookEvent.giftCardId` added.

## State machine

```
   purchase()                webhook paid           deliver()/scheduler
 (none) ──► PENDING_PAYMENT ───────────────► ACTIVE ──────────────► (emailed)
                  │                            │
       webhook failed │              redeem()  │       adminVoid()
                  ▼                            ▼            ▼
                VOID                       REDEEMED        VOID
                                  lazy expiry │
                                              ▼
                                          EXPIRED   (admin promo cards only)
```

## Manual test list

1. **Purchase happy path.** `/gift-cards` → pick $50 → recipient email → Stripe test card `4242…` → confirm → card `PENDING_PAYMENT` → Stripe webhook → `ACTIVE` → recipient emailed, purchaser emailed.
2. **Scheduled delivery.** Set `deliverAt` to tomorrow → after capture the card is `ACTIVE` with `deliveredAt = null` → `GIFTCARD_SCHEDULER_ENABLED=1` scan once the date passes → recipient emailed.
3. **Redeem.** Recipient opens `/account/gift-cards?code=…` (link from email) → Check balance → Redeem → wallet credited, card `REDEEMED`.
4. **Double-redeem.** Redeem the same code twice → second attempt 409 `already been redeemed`.
5. **Concurrent redeem.** Fire two `redeem` calls for one code → exactly one credits the wallet; the other 409s (conditional `updateMany` claim).
6. **Payment failure.** Use a declining test card → webhook `payment_intent.payment_failed` → card `VOID`.
7. **Admin promo issue.** `/gift-cards` (admin) → issue $25 to an email → card `ACTIVE` immediately, recipient emailed, no payment.
8. **Admin void.** Void an `ACTIVE` card → `VOID`, `balanceMinor` 0, redeem now fails. Voiding a `REDEEMED` card → 409.
9. **Expiry.** Issue an admin card with `expiresAt` = yesterday-ish (or wait) → `check` flips it to `EXPIRED`, redeem fails.
10. **Amount bounds.** Purchase below $5 or above $1000 → 400 from the DTO validator and the service.
11. **Webhook idempotency.** Replay a `payment_intent.succeeded` → `markPaid` no-ops on the second call (card already `ACTIVE`).

## Decisions worth highlighting

- **Redemption transfers the whole balance into the wallet** rather than implementing partial gift-card spend at checkout. The wallet already does partial spend (Phase 9), so a second partial-balance mechanism would be redundant surface. "Redeem → store credit" is also the dominant mental model for buyers.
- **No separate `GiftCardRedemption` table.** The `WalletTransaction` row (`kind: CREDIT_GIFT_CARD`, reason naming the code) plus `GiftCard.redeemedByUserId/redeemedAt` fully capture the event. One model, not two.
- **Gift-card purchase rides the existing webhook**, threaded exactly like Phase 23 subscriptions and Phase 29 Connect events — an early `evt.giftCardId` branch that emits a domain event and returns before the order-keyed `Payment` lookup. No parallel payment rail.
- **Conditional-update claim for redemption** instead of a DB transaction with row locking — `updateMany({ where: { status: 'ACTIVE' } })` is a single atomic compare-and-set that Postgres serializes for us, and the rollback path covers the (rare) wallet-write failure.
- **No expiry on paid cards.** Several jurisdictions (US CARD Act, parts of the EU/AU) restrict or ban gift-card expiry. `expiresAt = null` by default is the safe choice; admin promo cards can opt into an expiry where legal.
- **Bounds $5–$1000.** Validated both in the DTO (`@Min/@Max`) and in `GiftCardsService.validateAmount` so the admin-issue path (same service, different controller) is covered too.
- **Code format `ONS-XXXX-XXXX-XXXX`** over a 31-char ambiguity-free alphabet (~59 bits). Auth-gated + rate-limited redemption makes guessing a non-threat; the format is chosen for clean transcription off a screen.

## Limitations / follow-ons

- **No reload / top-up** of an existing card — a new purchase is a new card.
- **No partial gift-card application at checkout** — redeem-to-wallet then spend.
- **No printable / PDF card.**
- **Scheduled delivery can't be edited** after purchase.
- **No bulk CSV issuance** for corporate gifting.
- **Dev testing needs Stripe test keys** — gift-card purchase always goes through a real PaymentIntent (the `mock` provider returns a null `clientSecret`, so the card stays `PENDING_PAYMENT`). This matches the "no stubs in payment" rule.
- **Refund of a gift-card purchase** isn't wired — once captured, a card is voided manually by an admin if needed; the buyer's card payment refund would be a Stripe-dashboard action today.
