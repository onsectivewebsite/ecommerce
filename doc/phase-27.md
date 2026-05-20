# Phase 27 — In-app Notification Center

Date opened: 2026-05-19
Predecessor: Phase 26 (Privacy, Data Export & Deletion)

## 1. Why this phase

The platform has been emitting events that matter to the buyer
since Phase 1, and Phase 11 introduced email + Phase 7 added
push. Today those reach the buyer in two places: their inbox and
their phone. They do not reach them inside Onsective.

That gap shows up in three concrete ways:
1. A buyer who paused Plus because their card failed doesn't
   discover it until they open their email — often days later.
2. A buyer whose referral just paid out has no on-platform
   confirmation that "your friend joined and you earned 500 pts".
3. A buyer who arrives at an order page deep-linked from an
   email has no surrounding context: what other notifications
   they have, whether they've read this one.

Phase 27 ships a database-backed notification feed: every event
that matters writes a row to the buyer's feed, the buyer sees a
bell + unread badge in TopBar, and `/account/inbox` shows the
full history.

## 2. Scope (in)

### 2.1 Notification model
```
Notification {
  id, userId,
  kind: NotificationKind,
  title String,
  body  String,
  deepLinkPath?,        // e.g., "/account/membership"
  payload? Json,        // small contextual data (orderId, ticketId, …)
  readAt?,
  createdAt
}
```

`NotificationKind` enumerates the well-known event kinds:
```
PLUS_RENEWED
PLUS_PAYMENT_FAILED
PLUS_EXPIRING_SOON
PLUS_EXPIRED
REFERRAL_REDEEMED
ORDER_PAID
ORDER_SHIPPED
ORDER_DELIVERED
MESSAGE_NEW
REVIEW_POSTED
SECURITY_SIGN_IN
GENERIC
```

We intentionally don't try to model every channel state (email
sent? push sent?) on this table — that belongs in
`MessagingService` / `EmailService` audit. This row represents
the buyer's read-side feed only.

### 2.2 NotificationFeedService
- `write({ userId, kind, title, body, deepLinkPath?, payload? })`
  — synchronous DB insert. Returns the row.
- `list({ userId, unreadOnly?, cursor?, limit? })` — cursor-based
  pagination (50 default, 200 max). Cursor is the createdAt of
  the last row.
- `unreadCount(userId)` — single COUNT query, cached at the
  caller if desired.
- `markRead(userId, id)` — sets `readAt=now` if not set; no-op
  otherwise.
- `markAllRead(userId)` — single UPDATE; returns the count.

### 2.3 Wiring into existing listeners
Add a `feed.write` call alongside the existing email/push send
in each of:

- `PlusNotificationsListener` — already covers renewed /
  payment_failed / expired. Add expiring_soon via the existing
  Phase 24 scheduler path.
- `ReferralPayoutListener` — write a REFERRAL_REDEEMED row for
  the inviter on successful payout.
- Order lifecycle — add a small listener in the existing
  orders module: ORDER_PAID on `order.paid`, ORDER_SHIPPED on
  `shipment.dispatched`, ORDER_DELIVERED on `shipment.delivered`.
- Messaging — wire `MessagingService.send` to feed.write for the
  recipient.
- Reviews — write REVIEW_POSTED on `review.created` for the
  seller (if the seller's `userId` is present).
- Security — write SECURITY_SIGN_IN on the existing security
  sign-in event for the user.

Each call is wrapped in try/catch + log — a feed write failure
must never roll back the source event.

### 2.4 Real-time delivery (best-effort)
The platform already runs a socket.io namespace from Phase 9
messaging. We add a `/notifications` namespace that joins a
per-user room (`user:<userId>`). `NotificationFeedService.write`
emits `notification:new` with the row payload after the DB
insert succeeds. The buyer-web subscribes when signed in and
bumps the unread count + (optionally) toasts.

Real-time is purely additive — the bell still polls every 60s
as a fallback in case the socket drops or wasn't connected.

### 2.5 Per-category opt-out behavior
`NotificationPreference` (Phase 11) maps category names to
per-channel flags. We honor `feed` as a new channel name
alongside `email`/`push`, but with a deliberate twist:
**a feed row is always written.** The opt-out only hides it
from the inbox UI via a `where: { OR: [...] }` clause in
`list()`. The reason: a buyer who later wants to audit "did I
get notified about X?" needs the row to exist. Toggling the
preference back to ON makes the existing rows reappear.

### 2.6 Buyer pages
- `/account/inbox` — list view, infinite-scroll cursor, mark-as-
  read on view, click → deep-link. Unread items show a small
  dot; read items are dimmed.
- TopBar bell — unread count badge. Click opens `/account/inbox`.

### 2.7 No admin surface
Notifications are buyer-private. The admin doesn't get an
override / impersonation view. If the platform needs to
broadcast announcements, that's a future phase using a
different model.

## 3. Scope (out)

- **Push-vs-email-vs-feed routing matrix.** We keep the existing
  per-channel writes independent. Adding the feed is purely
  additive.
- **Notification grouping** (e.g., "5 orders shipped"). Each
  event = one row.
- **Snooze / archive.** Read is the only status; archived rows
  age out via a future retention pass.
- **Rich content / images.** Title + body strings only.
- **Admin broadcast / announcements.** Out of scope.
- **Server-side analytics on engagement.** Out of scope.

## 4. Architectural decisions made up front

### 4.1 Feed is best-effort, never blocking
`feed.write` is called inside the existing listener try/catch
or wrapped in its own. A DB write failure here cannot fail the
parent event (e.g., `order.paid`). The platform always favors
"the buyer's order captures" over "the buyer sees a notification."

### 4.2 Hide-on-opt-out, don't skip-write
We always write the row. The opt-out filters at read time. This
inverts the obvious pattern but pays off:
- it lets buyers toggle prefs without losing history,
- audit-log views can show what notifications the buyer *would*
  have seen,
- the feed is the source of truth, not the preferences.

### 4.3 Cursor pagination on createdAt
We don't paginate by row id because notifications are
chronological from the buyer's perspective. Cursor = ISO
timestamp of the last row; next page is
`createdAt < cursor`.

### 4.4 Real-time is enhancement, never required
We do not depend on the socket for correctness. The bell polls
every 60s; the inbox refetches on focus. If the socket is up,
the bell updates faster. If it's down, the polling catches up.

### 4.5 Deep links are paths, not URLs
We store `/account/membership`, not `https://app.onsective.com/account/membership`.
This keeps the rows portable across environments (dev, staging,
prod) and lets the frontend decide whether to in-app-navigate
or full-reload.

### 4.6 Payload is denormalized
We snapshot `payload: { orderId, totalMinor, currency }` etc.
at write time so a deleted-then-anonymized order doesn't break
the inbox rendering. This matches the snapshot pattern used by
Phase 6 tax and Phase 20 sustainability.

### 4.7 One listener per source, not a meta-listener
We add one `feed.write` call where the existing listener
already runs. We do NOT centralize "translate any event into
a feed row" — too much indirection for too little gain. Each
listener owns its title/body copy in the same place it owns
the email template lookup.

## 5. Acceptance criteria

- `POST /notifications` (internal, via service) → row written.
- `GET /notifications` → returns recent rows with pagination.
- `GET /notifications/unread-count` → returns N.
- `POST /notifications/:id/read` → flips `readAt`.
- `POST /notifications/read-all` → flips all unread.
- A successful Plus renewal webhook produces a feed row of kind
  PLUS_RENEWED with `deepLinkPath=/account/membership`.
- A successful referral payout produces a REFERRAL_REDEEMED row
  for the inviter with the invitee's first name in `body`.
- An order's `order.paid` produces an ORDER_PAID row with
  `deepLinkPath=/orders/<id>`.
- TopBar bell shows the unread count (badge) when signed in;
  zero when no unread.
- `/account/inbox` lists rows with newest first; tapping a row
  marks it read and routes to the deep link.
- Disabling the `plus_renewed` category in
  `/account/preferences` (Phase 11) hides plus_renewed rows
  from `/account/inbox` but a re-enable surfaces them again.
- WebSocket connects to `/notifications` namespace, receives
  `notification:new` on subsequent writes, bumps the badge.
  Socket-down fallback polls every 60s.
- `doc/phase-27-debug.md` captures decisions + limitations.
