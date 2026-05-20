# Phase 27 — Debug Pass

Companion to `phase-27.md`. Decisions made, seams to watch, what to
test before merging.

## 1. The invariants Phase 27 preserves

1. **Feed writes never block source events.** Every `feed.write`
   call is wrapped in try/catch. A DB failure here cannot fail
   the parent lifecycle event (`order.paid`, plus renewal, etc.).
2. **The feed is the read-side, not the dispatcher.** Email and
   push live in their own services. This phase adds a third
   surface, not a routing matrix.
3. **Order matters but isn't strict.** Notification rows are
   ordered by `createdAt DESC` for the inbox view. Concurrent
   writes can land within the same millisecond — we don't try
   to enforce a strict per-event ordering because the buyer
   experiences "new" not "Nth".
4. **Read state is per-row, not per-kind.** Each row has its
   own `readAt`; marking all read flips them in one UPDATE.
5. **Real-time is enhancement, not requirement.** The bell
   polls every 60s as the primary signal. If a socket gateway
   exists it can also push `notification.created` events for
   sub-second updates, but no code path depends on it.

## 2. Non-obvious decisions

### 2.1 Listener writes, not service writes
Every place that emits an inbox-worthy domain event already has
a listener (PlusNotificationsListener, ReferralsService,
MessagingService). We added a `feed.write` call there rather
than a single mega-listener subscribing to every event. Pros:
each call owns its own title/body copy in the same file that
owns the email-template lookup. Cons: each new event kind
needs a code change in the source listener. Acceptable.

### 2.2 Order shipping uses the only event available
`shipping.service.ts` emits one event for any shipment change:
`shipment.updated` with just the shipmentId. We resolve the
current status in the listener and write ORDER_SHIPPED on
`PICKED_UP` or `IN_TRANSIT`, ORDER_DELIVERED on `DELIVERED`,
and skip the others. Edge case: if a shipment moves through
`PICKED_UP → IN_TRANSIT`, the buyer gets two ORDER_SHIPPED
rows. We accept this trade-off rather than adding state to the
shipment row just for the inbox.

### 2.3 Messaging is buyer-side only here
`message.new` carries `buyerUserId` and `sellerId`. We write a
feed row for the buyer when `senderKind` is `SELLER`, `ADMIN`,
or `SYSTEM`. The seller-portal inbox is its own surface from
Phase 9 — we don't dual-write into a seller-side feed.

### 2.4 Hide-on-opt-out, don't skip-write
We always write the row. Per-category preference (Phase 11)
filtering happens in `list()` at read time. Inversion lets
buyers toggle preferences without losing audit history.
Currently `list()` does NOT filter — we'll add the join to
NotificationPreference in a polish pass. For now, the only
opt-out path is the existing email/push channel; the feed is
unconditionally on.

### 2.5 Cursor on createdAt, not id
Notifications are time-ordered from the buyer's perspective.
Cursor is the ISO timestamp of the last returned row; next
page is `createdAt < cursor`. This matches how the inbox
renders ("show me older").

### 2.6 Payload is denormalized
We snapshot orderId/totalMinor/currency/threadId etc. into the
JSON `payload` column at write time. The inbox UI can render
some context without joining back to the source table; if the
source row is later deleted (or anonymized via Phase 26), the
inbox entry still has meaningful text.

### 2.7 Deep link is a path, not a URL
We store `/orders/abc`, not `https://app/.../orders/abc`. The
frontend decides routing. Survives env / domain changes.

### 2.8 Bell polls at 60s
A real-time socket push would be nicer but adds risk for a
soft-launch (socket auth, reconnect, room joins). The poll is
simple, idempotent, and cheap (single COUNT query). The
service emits `notification.created` on the internal event bus
so a future socket gateway can opt in with one OnEvent line.

### 2.9 No admin UI
Inbox is buyer-private. Admin can't impersonate or view a
buyer's feed. If a future broadcast feature lands, that's a
separate concern (different table, different access model).

### 2.10 Feed entries are never deleted on user anonymize
Phase 26's anonymize transaction does NOT scrub Notification
rows. Reason: the buyer was already signed out as part of
deletion; nobody reads their feed. We could add a delete to
the anonymize step in a future pass.

## 3. Things to test end-to-end

- Trigger a Plus renewal via Stripe webhook → email AND a
  PLUS_RENEWED inbox row land. Bell shows 1.
- Tap the bell → routes to `/account/inbox`. The renewed row
  shows with the success-tone label. Tap the row → routes to
  `/account/membership` and `readAt` flips.
- Force a failed invoice → PLUS_PAYMENT_FAILED inbox row with
  danger tone, deep-link `/account/payment-methods`.
- Run a referral payout end-to-end → REFERRAL_REDEEMED rows
  written for BOTH inviter and invitee, with their respective
  deep links (`/account/referrals`, `/account/points`).
- Place a paid order → ORDER_PAID row. Mock advance shipment
  through PICKED_UP → ORDER_SHIPPED row. Mark DELIVERED →
  ORDER_DELIVERED row.
- Seller replies in a message thread → MESSAGE_NEW row for the
  buyer.
- Open `/account/inbox` → cursor pagination works; 50 rows per
  page; "Load more" fetches next page.
- "Unread only" filter shows only rows with `readAt: null`.
- "Mark all read" flips the badge to 0.
- `GET /notifications/unread-count` matches the on-screen badge.
- Sign out → bell hidden. Sign back in → bell reflects current
  unread count.
- Force `feed.write` to throw (e.g., temporarily set the
  controller to call with a missing user id) → source event
  (order.paid) still completes successfully; warning is logged.

## 4. Known limitations

- **Per-category opt-out not yet honored at read time.** All
  written rows are visible. Adding the
  `NotificationPreference` join to `list()` is a polish
  follow-up.
- **Duplicate ORDER_SHIPPED rows** when a shipment transitions
  through both PICKED_UP and IN_TRANSIT (see §2.2). Acceptable.
- **`shipment.updated` ignores OUT_FOR_DELIVERY and EXCEPTION.**
  Could surface those as additional ORDER_SHIPPED variants in
  the future.
- **No socket-pushed real-time yet.** The internal event bus
  emits `notification.created` but no socket gateway listens.
  Wiring a buyer-facing socket namespace is a one-file polish
  task — deferred so the phase ships.
- **No retention / archival.** Rows accumulate forever. A
  future scheduler can purge read rows older than 90 days.
- **No grouping.** "5 orders shipped" → 5 rows. Acceptable for
  v1; high-volume buyers might want bundling.
- **No admin broadcast.** N/A for this phase.
- **`REVIEW_POSTED` not wired.** Sellers don't currently have
  a buyer-side feed; their portal handles this.
- **`SECURITY_SIGN_IN` not wired.** Phase 12's
  SecurityListener doesn't emit a domain event we can hang
  onto. A polish pass can add it.

## 5. Files added

- `services/api/src/modules/notification-feed/notification-feed.service.ts`
- `services/api/src/modules/notification-feed/notification-feed.controller.ts`
- `services/api/src/modules/notification-feed/notification-feed.module.ts`
- `services/api/src/modules/notification-feed/order-events.listener.ts`
- `packages/api-client/src/endpoints/notification-feed.ts`
- `apps/buyer-web/src/app/account/inbox/page.tsx`

## 6. Files edited

- `services/api/prisma/schema.prisma` — added
  `Notification` model, `NotificationKind` enum, and
  `User.notifications` back-relation.
- `services/api/src/app.module.ts` — registered
  `NotificationFeedModule`.
- `services/api/src/modules/loyalty/plus-notifications.listener.ts`
  — added `feed.write` to the three Plus event handlers.
- `services/api/src/modules/loyalty/plus-expiring-soon.scheduler.ts`
  — added `feed.write` alongside the existing email send.
- `services/api/src/modules/referrals/referrals.service.ts`
  — added `feed.write` for both sides on successful payout.
- `packages/api-client/src/index.ts` — re-export `notification-feed`.
- `apps/buyer-web/src/lib/api.ts` — wired `NotificationFeedApi`.
- `apps/buyer-web/src/components/TopBar.tsx` — bell icon
  with unread-count badge, 60s poll.
- `apps/buyer-web/src/app/account/page.tsx` — added
  "Inbox" tile.

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_27_inbox
pnpm -r typecheck
pnpm -r build
```

No new env vars. The migration adds one new table
(`Notification`), one new enum (`NotificationKind`), one new
back-relation on `User`. No backfill required — existing users
simply have no feed rows yet.
