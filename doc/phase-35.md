# Phase 35 — Gift Cards & Store Credit

> A purchasable gift card: a buyer pays for a card, the recipient gets a code by email, and redeeming the code moves the balance into the recipient's wallet (the Phase-9 store-credit ledger). Admins can also issue promotional cards without payment. Builds entirely on existing infrastructure — the wallet ledger, the Stripe payment gateway, the email module — with one new model.

## Goals

1. **Purchase.** A signed-in buyer buys a gift card for any amount within bounds, addressed to a recipient email, with an optional message and an optional scheduled delivery date. Paid via a real Stripe PaymentIntent.
2. **Delivery.** On payment capture the recipient is emailed the code (immediately, or at `deliverAt` via a scheduler). The purchaser gets a receipt email.
3. **Redemption.** Anyone signed in can redeem a code; the full remaining balance is transferred into their wallet as a `CREDIT_GIFT_CARD` ledger entry. The card is then `REDEEMED`.
4. **Preview before redeem.** A `check` endpoint reports a code's status + balance without consuming it, so the UI can show "this card is worth $50" before the user commits.
5. **Admin issuance.** Admins can issue promotional cards (no payment, immediately `ACTIVE`) and void unredeemed cards.
6. **Compliance-aware expiry.** Buyer-purchased cards have **no expiry** by default (US CARD Act bars expiry under 5 years; many jurisdictions ban it outright). Admin promo cards may carry an explicit `expiresAt`.

## Non-Goals

- Partial redemption at checkout. Redemption is all-or-nothing into the wallet; the wallet itself already handles partial spend at checkout (Phase 9). One less surface, same outcome.
- Physical/printed gift cards.
- Reloadable cards (top up an existing card). A new purchase = a new card.
- Gift cards as a catalog SKU. They're not certified physical goods; a dedicated flow is cleaner and avoids polluting the catalog.
- Refunding a redeemed card. Once the balance is in a wallet it follows wallet rules.

## Schema

```prisma
enum GiftCardStatus {
  PENDING_PAYMENT   // created, awaiting Stripe capture
  ACTIVE            // paid (or admin-issued), redeemable
  REDEEMED          // balance moved into a wallet
  VOID              // admin-cancelled, or payment failed
  EXPIRED           // past expiresAt (lazy flip on read)
}

model GiftCard {
  id                 String         @id
  /// Human-friendly, e.g. ONS-7F3K-9QmP-24XY. Unique, case-insensitive match on redeem.
  code               String         @unique
  status             GiftCardStatus @default(PENDING_PAYMENT)
  currency           String         @default("USD")
  initialAmountMinor Int
  /// Remaining redeemable balance. Equals initial until redeemed, then 0.
  balanceMinor       Int
  /// null for admin-issued promo cards.
  purchaserUserId    String?
  recipientEmail     String
  recipientName      String?
  senderName         String?
  message            String?
  /// Scheduled send. null = deliver as soon as payment captures.
  deliverAt          DateTime?
  deliveredAt        DateTime?
  redeemedByUserId   String?
  redeemedAt         DateTime?
  /// Stripe PaymentIntent id for buyer purchases.
  paymentRef         String?
  /// Optional — null means no expiry (the compliant default for paid cards).
  expiresAt          DateTime?
  issuedByAdminId    String?
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt
  purchaser User? @relation("GiftCardPurchaser", fields: [purchaserUserId], references: [id])
  redeemer  User? @relation("GiftCardRedeemer", fields: [redeemedByUserId], references: [id])
  @@index([status, deliverAt])
  @@index([purchaserUserId])
  @@index([recipientEmail])
}
```

Plus one new `WalletTxnKind`: `CREDIT_GIFT_CARD`. No separate redemption table — the wallet ledger *is* the redemption record, and `GiftCard.redeemedByUserId / redeemedAt` capture the rest.

## Payment plumbing

A gift card purchase is not an order, so it can't use the order-keyed `Payment` row. We thread it through the webhook the same disciplined way Phase 23 subscriptions and Phase 29 Connect events were threaded:

- `PaymentIntentInput.orderId` becomes optional; a new optional `giftCardId` is added.
- `StripeProvider.createIntent` sets PI metadata to `{ orderId }` **or** `{ giftCardId }`.
- `parseWebhook` reads `giftCardId` from PI metadata onto `payment_captured` / `payment_failed` events.
- `PaymentsService.handleWebhook` gets an early branch: if the event carries a `giftCardId`, emit `giftcard.purchase.paid` / `giftcard.purchase.failed` and return — before the `Payment` table lookup (which would find nothing).

`GiftCardPurchaseListener` subscribes to those events.

## Flows

### Purchase

```
POST /gift-cards/purchase
  { amountMinor, recipientEmail, recipientName?, senderName?, message?, deliverAt? }
  (JWT required — the purchaser)
  → validate amountMinor in [MIN, MAX]  (MIN = $5, MAX = $1000)
  → create GiftCard(PENDING_PAYMENT) with a generated code
  → StripeProvider.createIntent({ giftCardId, amountMinor, currency, buyerEmail })
  → return { giftCardId, clientSecret }
```

Buyer confirms the PaymentIntent client-side with Stripe.js (same as checkout / payment-methods).

```
Stripe webhook payment_intent.succeeded (metadata.giftCardId)
  → emit giftcard.purchase.paid
  → GiftCardPurchaseListener:
       GiftCard → ACTIVE, balanceMinor = initialAmountMinor
       if deliverAt is null or in the past → deliver now
       email the purchaser a receipt

Stripe webhook payment_intent.payment_failed (metadata.giftCardId)
  → emit giftcard.purchase.failed
  → GiftCard → VOID
```

### Delivery

`GiftCardDeliveryScheduler` (hourly, env-gated `GIFTCARD_SCHEDULER_ENABLED=1`) scans `ACTIVE` cards with `deliveredAt = null` and `deliverAt <= now`, emails the recipient the `gift_card_received` template, sets `deliveredAt`. Cards with no `deliverAt` are delivered inline by the purchase listener.

### Redemption

```
GET  /gift-cards/check?code=...      (JWT required)
  → { status, balanceMinor, currency, expiresAt }  — no mutation

POST /gift-cards/redeem { code }     (JWT required)
  → load by code (case-insensitive), require ACTIVE + balance > 0 + not expired
  → WalletService.applyDelta(+balanceMinor, kind=CREDIT_GIFT_CARD)
  → GiftCard → REDEEMED, balanceMinor = 0, redeemedByUserId/redeemedAt set
  → return { creditedMinor, walletBalanceMinor }
```

A card cannot be redeemed by its own purchaser only if it's still `PENDING_PAYMENT`; once `ACTIVE` anyone (including the buyer) may redeem — buying yourself store credit via a gift card is legitimate.

### Lazy expiry

On any read of an `ACTIVE` card whose `expiresAt` has passed, flip it to `EXPIRED` before returning. Mirrors the Phase 22 membership / Phase 26 export pattern.

### Admin

```
POST  /admin/gift-cards/issue { amountMinor, recipientEmail, recipientName?, message?, expiresAt? }
  → create GiftCard ACTIVE immediately (no payment), issuedByAdminId set, deliver now
POST  /admin/gift-cards/:id/void
  → ACTIVE/PENDING_PAYMENT → VOID (refuses REDEEMED)
GET   /admin/gift-cards?status=&q=
  → list / search by code or recipient email
```

## Email templates (new)

- `gift_card_received` — to the recipient: the code, amount, sender name, message, a redeem link.
- `gift_card_purchase_receipt` — to the purchaser: confirmation + amount + recipient.

Both `transactional` (Phase 32 taxonomy).

## Endpoints summary

| Method | Path | Auth | Rate limit |
|--------|------|------|------------|
| POST | `/gift-cards/purchase` | JWT | `giftcard.purchase` 10/3600s user |
| GET  | `/gift-cards/check` | JWT | — |
| POST | `/gift-cards/redeem` | JWT | `giftcard.redeem` 10/3600s user |
| GET  | `/gift-cards/mine` | JWT | — |
| POST | `/admin/gift-cards/issue` | ADMIN | — |
| POST | `/admin/gift-cards/:id/void` | ADMIN | — |
| GET  | `/admin/gift-cards` | ADMIN | — |

## API client

```ts
class GiftCardsApi {
  purchase(body): Promise<{ giftCardId: string; clientSecret: string }>
  check(code: string): Promise<GiftCardCheck>
  redeem(code: string): Promise<{ creditedMinor: number; walletBalanceMinor: number }>
  mine(): Promise<GiftCardRow[]>
}
class AdminGiftCardsApi {
  issue(body): Promise<GiftCardRow>
  void(id: string): Promise<{ ok: true }>
  list(params?): Promise<GiftCardRow[]>
}
```

## Frontend

- **buyer-web `/gift-cards`** — purchase page: amount presets + custom, recipient fields, optional message + schedule date, Stripe Elements payment (same pattern as `/account/payment-methods`).
- **buyer-web `/account/gift-cards`** — "Redeem a gift card" form (check → confirm → redeem, shows resulting wallet balance) + a list of cards I purchased with status.
- **admin-web `/gift-cards`** — list/search, an "Issue promo card" form, void buttons.

## Out-of-scope follow-ons

- Reloadable cards / balance top-up.
- Partial-balance gift cards applied directly at checkout (wallet already covers this).
- Printable / PDF gift cards.
- Scheduled-delivery editing after purchase.
- Bulk admin issuance (CSV) for corporate gifting.
