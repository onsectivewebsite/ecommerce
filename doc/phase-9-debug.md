# Phase 9 — Debug & Wire-Up Notes

Date: 2026-05-17

Phase 9 added five interlocking modules to the API and matching pages across
all three web portals. This doc captures (a) the non-obvious design
decisions made during the build and (b) issues caught during the post-build
debug pass — the things a reviewer would otherwise have to reverse-engineer
from the diff.

---

## 1. Schema decisions captured during the build

### 1.1 Return shipping is embedded on `Return`, not a second `Shipment` row
`Shipment.orderId` is `@unique`, so we cannot create a second `Shipment` row
for the return leg without breaking the outbound `Order ↔ Shipment` invariant
that everything else (payouts, tracking, notifications) depends on.

Decision: keep one outbound `Shipment` per order, and store the return-leg
metadata directly on `Return`:

- `returnCarrierCode`, `returnTrackingNumber`, `returnLabelObjectKey`
- `returnPublicToken @unique` (so the carrier webhook can find the return
  without needing to know our internal IDs)
- `returnShippedAt`

The Carrier adapter for return labels just swaps origin/destination on the
existing carrier integration (`ShippingService.purchaseReturnLabel`). No new
adapter surface area was introduced.

### 1.2 Reviews aggregate lives in the search index, not on `Product`
`ratingAvg` and `ratingCount` are NOT denormalized onto the `Product` row.
They are computed in `ReviewsService.refreshProductAggregate` and pushed into
the Elasticsearch document for the product on every review write/delete.
`SearchIndexer.indexProduct(productId)` reads them inline.

Rationale: PDP reads the aggregate via the public reviews endpoint
(`GET /reviews/product/:productId` already returns `{ ratingAvg, ratingCount,
distribution }`), and search needs them in ES anyway for ranking and filter
facets. Carrying them on `Product` would introduce a third copy with no
consumer.

`SearchIndexer.bulkSync` / `incrementalSync` deliberately skip the rating
lookup to avoid an N+1 during full re-indexing — the rating field on those
docs starts at 0 and is populated by the next per-product write that fires
through `indexProduct`.

### 1.3 Refund is triggered on carrier drop-off scan
Five places can trigger a refund on a return:
1. Seller marks received early → `runRefund(trigger='seller-confirm')`.
2. Buyer dropped at carrier (manual confirm) → `runRefund(trigger='carrier-scan')`.
3. Carrier webhook fires `return.carrier.pickup` event with the
   `returnPublicToken` → `ReturnsListener.onPickup` → `runRefund`.
4. Admin force-refund (override) → `runRefund(trigger='admin-force')`.
5. Dispute resolved buyer-favored → `DisputesService.resolve` calls
   `PaymentsService.refundOrder` directly (does not go through `Return`).

`runRefund` is idempotent: re-firing on an already-`REFUNDED` return is a
no-op. The single emitter of `return.refunded` is `runRefund` so listeners
(ledger, push) only fire once regardless of which trigger ran.

### 1.4 Disputes are a first-class table, not a thread flag
A `MessageThread` can be `ESCALATED` (admin attention needed), but a
`Dispute` is the formal record of fund-recovery contention. They are linked
1:1 via `Dispute.threadId @unique` but can exist independently:

- `CHARGEBACK` disputes from Stripe webhooks may pre-date any thread (if the
  buyer never messaged before going to their bank).
- A thread can be escalated without becoming a dispute (admin just needs to
  unblock communication).

This separation also lets disputes attach to the right artifact:
`Dispute.returnId`, `Dispute.shipmentId`, `Dispute.paymentId` are all
optional. Chargebacks set `paymentId`; return appeals set `returnId`.

### 1.5 Per-thread mute, not global do-not-disturb
`MessageThread.mutedByBuyer` / `mutedBySeller` lets either party silence
push notifications for a specific order's thread without breaking pushes for
other orders. Read receipts (`Message.readByBuyer/readBySeller`) flip on the
thread fetch (`getThread` → `markRead`); we do not require a separate "mark
read" round-trip for typical interactive use, though the explicit
`POST /messaging/:id/read` endpoint exists for clients that want it.

---

## 2. Issues caught during the post-build debug pass

### 2.1 `ReturnStatus` enum is `SHIPPED`, not `IN_TRANSIT`
Initial frontend pages on all three portals used `IN_TRANSIT` as a status
constant. The Prisma enum is `SHIPPED`. Fixed in:
- `apps/buyer-web/src/app/account/returns/page.tsx`
- `apps/seller-web/src/app/returns/page.tsx`
- `apps/admin-web/src/app/returns/page.tsx`

### 2.2 `ReturnReason` enum did not include `CHANGED_MIND` or `NEVER_ARRIVED`
The buyer "new return" page initially used those friendly labels. Replaced
with the actual enum values: `WRONG_ITEM`, `DAMAGED`, `NOT_AS_DESCRIBED`,
`NO_LONGER_NEEDED`, `ARRIVED_LATE`, `OTHER`. The labels are still
human-readable in the UI because we lowercase + de-snake them at render time.

### 2.3 `class-validator` `@IsEnum` cannot take a `string[]` literal
`DisputesService.resolve` originally declared its `outcome` DTO field as:
```ts
@IsEnum(['RESOLVED_BUYER', ...] as any)
```
`@IsEnum` validates against an object's values, not an array — it would
silently let any string through. Replaced with an as-const object literal so
validation actually runs:
```ts
const DISPUTE_OUTCOMES = { RESOLVED_BUYER: 'RESOLVED_BUYER', ... } as const;
@IsEnum(DISPUTE_OUTCOMES) outcome!: keyof typeof DISPUTE_OUTCOMES;
```

### 2.4 Returns api-client did not match server routes
Initial client called `/returns` (list), `POST /returns/:id/cancel`, and
posted a body to `force-refund`. Server routes are `/returns/mine`,
`DELETE /returns/:id`, and `POST /admin/returns/:id/force-refund` (no body).
Also added a missing `GET /returns/:id/label` endpoint on the server so the
buyer can fetch a presigned download URL for the return label PDF via
`ReturnsService.getLabelUrl(buyerUserId, returnId)` (enforces ownership).

### 2.5 `MediaService` only had `presignGetUrl`
Messaging attachments need a presigned PUT so clients upload directly to
MinIO. Refactored `presignGetUrl` to delegate to a private `presignUrl(method,
key, ttlSec)` and exposed `presignPutUrl(key, ttlSec = 300)` for messaging
(used at `POST /messaging/:threadId/attachments/presign`). Backward compatible
— `presignGetUrl` still works for the existing media/digital-goods callers.

### 2.6 Stripe webhook needed a chargeback branch
`StripePaymentProvider.parseWebhook` did not handle `charge.dispute.created`.
Added a new `payment_disputed` webhook event type
(`PaymentWebhookEvent.type`) and wired it through `PaymentsService.handleWebhook`
to emit `payment.disputed` with `{ orderId, paymentId, amountMinor, reason }`.
`DisputesListener.onPaymentDisputed` then opens a `CHARGEBACK` dispute.

Chargebacks never call `PaymentsService.refundOrder` — the network has
already moved the funds. `DisputesService.resolve` skips the refund call
when `kind === 'CHARGEBACK'` even on a buyer-favored outcome.

---

## 3. Wire-up checklist

- `app.module.ts`: ReturnsModule, ReviewsModule, MessagingModule, DisputesModule,
  SupportModule registered (ordering after PaymentsModule + before AdminModule).
- `MessagingModule` imports `AuthModule` for the WS gateway's `JwtService`
  (Socket.IO handshake auth).
- `NotificationsModule` is imported by `MessagingModule` so the messaging
  listener can call `NotificationsService.sendToUser`.
- `MessagingModule` is imported by both `DisputesModule` and `SupportModule`
  so they can post SYSTEM messages on the thread when escalation / resolution
  happens.
- `NotificationsListener` extended with handlers for: `return.requested`,
  `return.approved`, `return.rejected`, `return.refunded`, `review.posted`,
  `dispute.opened`, `dispute.resolved` (counter-party only, per-thread mute
  honored for messaging pushes).

## 4. Operational notes

- `SUPPORT_SELLER_SLA_HOURS` env var (default `48`) controls when a
  WAITING_SELLER thread is treated as past SLA. Past-SLA threads appear in
  the default admin inbox queue and unlock the one-click platform refund
  without `override=true`.
- `SearchIndexer.bulkSync` does not populate rating fields. After a full
  rebuild, ratings populate naturally as products receive their next review
  write. If you want them populated immediately after rebuild, run a query
  like `SELECT productId FROM "Review" WHERE status='VISIBLE' GROUP BY 1` and
  call `indexProduct(id)` for each — there is no scheduled job for this yet.
- Carrier webhook integration for return-leg tracking is stubbed at the
  event level (`return.carrier.pickup`). Real carrier adapters need to be
  extended to emit this event when they see a pickup scan on a tracking
  number that exists in `Return.returnTrackingNumber`. Until then the buyer
  drop-off endpoint serves as the manual confirmation path.

## 5. Things deliberately not in Phase 9

- Bulk return management for sellers (CSV export of pending returns).
- Public review photo uploads (only buyer attachment to the seller via
  messaging is wired).
- Buyer review edit window (current behavior: write-once, delete-only).
- Dispute evidence upload for sellers responding to chargebacks (Stripe
  evidence submission is a manual admin task today).
- Localized PDF return labels (carrier adapter returns whatever the carrier
  generates, English-only today).

These are deferred to a Phase 10 or treated as quick follow-ups depending on
real usage signals.
