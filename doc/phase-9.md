# Phase 9 — Marketplace Trust & Operations

> Status: 📋 awaiting approval · Owner: platform · Window: TBD

Phase 9 closes the post-purchase loop. The 8-phase master plan got buyers to checkout, the order to their door, and the seller paid. Phase 9 covers the four months *after* that: returns + refunds, reviews + ratings, buyer-seller messaging, and an admin customer-support inbox with a dispute escalation path. Together they convert Onsective from "you can transact here" to "you can rely on this marketplace."

## 1. Goals

1. **Returns & refunds**: buyer-initiated return on a delivered order → seller approves/rejects with reason → if approved, system issues a return shipping label (existing carrier abstraction) → on scan or seller confirmation, refund is issued via the original payment provider → ledger posts a balanced mirror of the original sale.
2. **Reviews & ratings**: buyer of a delivered order can leave a 1–5 star rating + text review on each ordered product. One review per `(userId, orderItemId)`. Seller can reply once. Admin can moderate (hide / unhide / annotate). PDP shows aggregate rating, review distribution, recent reviews.
3. **Buyer-seller messaging**: per-order conversation thread (`MessageThread` scoped to `orderId`). Real-time delivery via the existing Socket.IO gateway (new `messaging` namespace). Attachments via MinIO presigned uploads. Read receipts. Notification → push (via Phase 7 `NotificationsService`) + email (deferred to Phase 10).
4. **Customer support inbox**: admin queue of threads escalated by either side, with status (`OPEN` / `WAITING_BUYER` / `WAITING_SELLER` / `RESOLVED`), SLA timers, internal notes (not visible to buyer/seller), and a one-click "issue platform refund" path that bypasses the seller (used when a seller is unresponsive past SLA).
5. **Dispute lifecycle**: a return that gets rejected escalates to support after 48h of buyer pushback; a missing-delivery claim creates a dispute against the carrier shipment; chargebacks logged via Stripe webhook surface as disputes too.
6. **No regression**: the existing happy path stays identical for orders without returns / reviews / messages.

## 2. Non-goals (intentional, deferred)

- **Email delivery** — message + return notifications fan out to push only for now. The email worker (SendGrid / Postmark) lands in Phase 10 alongside marketing email templates.
- **Live chat with strangers** — messaging is *order-scoped*. There is no "browse a seller's profile and DM them" feature. (Spam vector; pre-purchase questions go through the PDP "Ask seller" form which creates a synthetic thread tied to the product, not the seller's inbox at large.)
- **Automated fraud scoring on returns** — heuristics like "buyer has returned >40% of their orders" surface in admin metrics but don't auto-block. Real fraud scoring is Phase 11.
- **Multi-step return reasons + photo upload required** — Phase 9 ships a single dropdown + optional photo. Reason taxonomies + structured fraud signals come with the analytics warehouse.
- **Seller appeal flow** for review moderation — a seller can request review of a hidden review by admin, but there's no formal appeal UI; they email support.
- **Cross-order returns / partial returns** — return is at the *order item* level (one or more items from one order). Splitting a return across multiple shipments is out of scope.

## 3. Data model additions

```
enum ReturnStatus       { REQUESTED  APPROVED  REJECTED  SHIPPED  RECEIVED  REFUNDED  CANCELLED }
enum ReturnReason       { WRONG_ITEM  DAMAGED  NOT_AS_DESCRIBED  NO_LONGER_NEEDED  ARRIVED_LATE  OTHER }
enum RefundMethod       { ORIGINAL  STORE_CREDIT  MANUAL }
enum ReviewStatus       { VISIBLE  HIDDEN_BY_ADMIN  DELETED_BY_BUYER }
enum MessageSenderKind  { BUYER  SELLER  ADMIN  SYSTEM }
enum ThreadStatus       { OPEN  WAITING_BUYER  WAITING_SELLER  RESOLVED  ESCALATED }
enum DisputeKind        { RETURN  MISSING_DELIVERY  CHARGEBACK  OTHER }
enum DisputeStatus      { OPEN  RESOLVED_BUYER  RESOLVED_SELLER  RESOLVED_SPLIT  CLOSED_NO_ACTION }

model Return {
  id               String         @id
  orderId          String
  buyerUserId      String
  sellerId         String
  reason           ReturnReason
  buyerNote        String?
  photoObjectKey   String?
  status           ReturnStatus   @default(REQUESTED)
  sellerNote       String?
  shipmentId       String?        @unique          // return-leg shipment when approved
  refundMethod     RefundMethod   @default(ORIGINAL)
  refundAmountMinor Int           @default(0)
  approvedAt       DateTime?
  rejectedAt       DateTime?
  receivedAt       DateTime?
  refundedAt       DateTime?
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  order       Order        @relation(fields: [orderId], references: [id], onDelete: Cascade)
  buyer       User         @relation("ReturnBuyer", fields: [buyerUserId], references: [id])
  seller      Seller       @relation(fields: [sellerId], references: [id])
  items       ReturnItem[]
  shipment    Shipment?    @relation(fields: [shipmentId], references: [id])

  @@index([buyerUserId, status])
  @@index([sellerId, status])
  @@index([status, createdAt])
}

model ReturnItem {
  id            String  @id
  returnId      String
  orderItemId   String
  qty           Int
  refundMinor   Int

  return     Return    @relation(fields: [returnId], references: [id], onDelete: Cascade)
  orderItem  OrderItem @relation(fields: [orderItemId], references: [id])

  @@unique([returnId, orderItemId])
}

model Review {
  id            String       @id
  productId     String
  buyerUserId   String
  orderItemId   String       @unique
  rating        Int                                // 1..5
  title         String?
  body          String
  status        ReviewStatus @default(VISIBLE)
  sellerReply   String?
  sellerRepliedAt DateTime?
  hiddenReason  String?
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  product   Product   @relation(fields: [productId], references: [id], onDelete: Cascade)
  buyer     User      @relation("ReviewBuyer", fields: [buyerUserId], references: [id], onDelete: Cascade)
  orderItem OrderItem @relation(fields: [orderItemId], references: [id])

  @@index([productId, status, createdAt])
  @@index([buyerUserId])
}

model MessageThread {
  id           String        @id
  orderId      String        @unique
  buyerUserId  String
  sellerId     String
  status       ThreadStatus  @default(OPEN)
  lastMessageAt DateTime     @default(now())
  unreadByBuyer  Int         @default(0)
  unreadBySeller Int         @default(0)
  escalatedAt  DateTime?
  resolvedAt   DateTime?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  order     Order      @relation(fields: [orderId], references: [id], onDelete: Cascade)
  buyer     User       @relation("ThreadBuyer", fields: [buyerUserId], references: [id])
  seller    Seller     @relation(fields: [sellerId], references: [id])
  messages  Message[]
  dispute   Dispute?

  @@index([buyerUserId, lastMessageAt])
  @@index([sellerId, lastMessageAt])
  @@index([status, lastMessageAt])
}

model Message {
  id           String              @id
  threadId     String
  senderKind   MessageSenderKind
  senderUserId String?
  body         String
  attachmentKeys String[]          @default([])
  readByBuyer  Boolean             @default(false)
  readBySeller Boolean             @default(false)
  createdAt    DateTime            @default(now())

  thread MessageThread @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId, createdAt])
}

model Dispute {
  id               String         @id
  kind             DisputeKind
  status           DisputeStatus  @default(OPEN)
  threadId         String?        @unique
  returnId         String?
  shipmentId       String?
  paymentId        String?
  openedByUserId   String?
  assignedAdminId  String?
  resolutionNote   String?
  resolutionMinor  Int            @default(0)      // platform refund amount, if any
  openedAt         DateTime       @default(now())
  resolvedAt       DateTime?
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  thread  MessageThread? @relation(fields: [threadId], references: [id])

  @@index([status, openedAt])
  @@index([assignedAdminId, status])
}
```

(Back-relations added on `Order`, `OrderItem`, `Product`, `User`, `Seller`, `Shipment`, `Payment`.)

## 4. Backend module layout

```
services/api/src/modules/returns/
  returns.module.ts
  returns.service.ts             # request, approve, reject, ship-label, receive, refund
  returns.controller.ts          # buyer + seller endpoints
  admin-returns.controller.ts
  returns.listener.ts            # @OnEvent('shipment.updated') — flips RECEIVED on return-leg delivery

services/api/src/modules/reviews/
  reviews.module.ts
  reviews.service.ts             # create, sellerReply, adminHide, aggregate
  reviews.controller.ts          # buyer create, public list
  admin-reviews.controller.ts

services/api/src/modules/messaging/
  messaging.module.ts
  threads.service.ts             # ensureThreadForOrder, list, markRead
  messages.service.ts            # send, list, attachmentUploadUrl
  messaging.gateway.ts           # Socket.IO `messages` events: thread:join, message:new
  messaging.controller.ts        # REST fallback for clients without sockets

services/api/src/modules/support/
  support.module.ts
  support.service.ts             # escalation lifecycle, SLA timer
  admin-support.controller.ts    # admin inbox + assign + resolve + platform refund

services/api/src/modules/disputes/
  disputes.module.ts
  disputes.service.ts            # createFromReturnRejected, createFromMissingDelivery, createFromChargeback
  disputes.listener.ts           # listens to Stripe chargeback webhooks + return.rejected
```

### Cross-cutting integrations

- **`OrdersService.refund(orderId, amount, reason)`** new path. Calls into `PaymentsService` (gateway-specific refund) → on success, emits `order.refunded` → ledger reverses the original posting via the existing `CommissionBooker.onRefunded`.
- **`PaymentsService`** gains `refund(payment, amountMinor, reason)` on the Stripe + mock providers.
- **`ShippingService`** gains `purchaseReturnLabel(orderId, items)` that flips the from/to addresses and routes through the same carrier the original shipment used.
- **`NotificationsListener`** fans push messages for: `return.requested`, `return.approved`, `return.rejected`, `review.posted` (to seller), `message.new` (to other party), `dispute.opened`, `dispute.resolved`.
- **`SearchIndexer`** updates the product doc with the new aggregate `ratingAvg` and `ratingCount` so search can sort/filter by rating.

## 5. Frontend deliverables

### Buyer-web
- `/orders/[id]/return` — start a return, pick items, reason, optional photo upload.
- `/orders/[id]/messages` — inline thread with the seller (Socket.IO + REST fallback).
- PDP — aggregate rating + review distribution + 5 most recent reviews + "Write a review" CTA when the buyer has a delivered orderItem.
- Account → "Returns" tab — list of in-flight returns with status.

### Seller-web
- `/orders` — order rows show a "View thread" link + unread badge.
- `/returns` — incoming return requests with approve/reject + return label print.
- `/reviews` — list of reviews on their products with reply UI.

### Admin-web
- `/support` — inbox of escalated threads, SLA timers, assign-to-me, internal notes, platform-refund action.
- `/disputes` — kind-filtered list (RETURN / MISSING_DELIVERY / CHARGEBACK), resolve actions.
- `/reviews` — moderation queue: hide / unhide with reason.

### Mobile (Phase 7 surface)
- Orders → tap → see thread + return CTA inline; no separate dedicated screens. Push notifications carry `screen: 'Order'` data so taps already land on the right place.

## 6. Decisions log (Phase 9)

| ID | Decision | Rationale |
| -- | -------- | --------- |
| D-056 | One thread per order, not per buyer-seller relationship | Order-scoped means support has a concrete artifact to attach a dispute to, ledger reversals have a clear scope, and the seller's inbox stays grouped by the thing that matters (the order). |
| D-057 | Return ships via the same carrier abstraction, with origin/destination swapped | Reuses the Phase 2 work and PDF generator. Manual returns (carrier-agnostic) covered by the existing manual/mock adapter path. |
| D-058 | Reviews keyed on `orderItemId @unique`, not `(userId, productId)` | Lets a buyer who bought the same product twice leave two reviews (genuine signal — same product, two experiences). The PDP aggregator dedupes recent reviews per buyer by recency. |
| D-059 | Disputes are *separate* from threads but link to one | A thread can exist without escalation; a dispute always has at least one thread (the convo that created it). Admins resolve disputes; threads can stay open afterwards. |
| D-060 | Chargebacks land as `Dispute` + a frozen Payout adjustment | We don't auto-claw-back from the seller; admin reviews the chargeback evidence and either marks `RESOLVED_SELLER` (seller eats the cost) or `RESOLVED_BUYER` (platform eats it). Ledger posting happens at resolution, not on receipt of the chargeback webhook. |
| D-061 | Messaging attachments via MinIO presigned PUT, not server-mediated | Avoids tying up an api worker per upload; the same approach as Phase 5 license-key file uploads. Server validates the resulting object key against an allow-list of MIME types on the next message send. |
| D-062 | Platform refund bypass only after seller is past the SLA | Admin sees a "Issue platform refund" button only when the thread is `WAITING_SELLER` past its SLA. Prevents support from over-using the bypass and prevents buyer-of-last-resort behavior gaming. |

## 7. Exit criteria

- A buyer can request a return on a delivered order, the seller approves it, a return label PDF is issued, the buyer drops the parcel off, the carrier scan triggers the refund, the buyer's card is credited, and the ledger nets to zero on that order — all without admin involvement.
- A delivered orderItem's "Write a review" CTA appears on the buyer's order detail. The submitted review shows on the PDP within the next page load. The seller can reply once.
- A buyer and a seller can exchange messages on an order thread in real time; the other party sees the unread badge update and receives a push notification within ~5s.
- An admin can see all OPEN disputes, assign one to themselves, add an internal note, and resolve it (with a one-click platform refund if needed). Resolution writes an `AuditLogEntry`.
- A chargeback webhook from Stripe creates a Dispute row + a thread message; the admin's `/disputes` page shows it within seconds.
- `doc/phase-9-debug.md` lists all issues found and fixed.

## 8. Open questions for approval

Before I start cutting code, please confirm or redirect:

1. **Refund timing model**: Phase 9 refunds *on carrier-scan of the return label* (the buyer dropped it off). Some marketplaces wait until the seller scans the parcel back in. The "on drop-off" model is faster for buyers but exposes the platform to bait-and-switch (buyer ships an empty box). Default: on drop-off, with admin override. Confirm?
2. **Review eligibility window**: 90 days post-delivery is the proposed default — after which the "Write a review" CTA hides. Long enough to capture real experience, short enough to keep reviews relevant. Adjust?
3. **Messaging retention**: threads are never auto-deleted; admin can manually purge for GDPR requests. Confirm?
4. **Push notification volume**: every new message pushes by default. Some buyers find that noisy. Default-on with a per-thread mute toggle? Or default-off?

Reply with "go" (and any adjustments) and I'll start with the schema + returns module.
