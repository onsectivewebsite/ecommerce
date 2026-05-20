# Phase 11 — Debug & Wire-Up Notes

Date: 2026-05-18

Phase 11 added four interdependent modules — transactional email, seller
analytics, inventory forecasting, seller webhooks — plus a per-category
notification preferences gate that affects every existing push category.
This doc captures the non-obvious decisions and what the post-build pass
caught.

---

## 1. Decisions captured during the build

### 1.1 Email and push are siblings; both check `NotificationPreference`
`NotificationsService.sendToUser` now reads `NotificationPreference.prefs`
and short-circuits if the user has opted out of push for the given
`categoryId`. The same check happens on the email path
(`EmailService.sendToUser`). Default behavior is opt-in for every category
— a missing preference row or missing category key means both channels
are enabled.

The reason for storing this as a JSON map instead of a column per category:
adding a new notification category (e.g., `wishlist_price_drop` from Phase
10) should not require a migration. Sellers and buyers don't see this
implementation choice; the UI renders a static list of known categories.

### 1.2 `EmailListener` mirrors `NotificationsListener` event-for-event
We considered making them one listener that fans out to both channels.
Kept them separate so the email pipeline can be disabled in tests / dev
without changing the push wiring, and so the email template logic doesn't
clutter the push handlers. The duplication is a few dozen lines and
catching a missing category at code-review time beats a runtime mystery.

### 1.3 ProductEvent is event-sourced and read-aggregated
Every product view, cart add, and checkout writes one `ProductEvent` row.
Reads (`SellerAnalyticsService.sellerOverview`) aggregate on the fly via
Prisma `groupBy`. Rationale:
- Single source of truth → no rollup-vs-source drift.
- `(sellerId, occurredAt)` index keeps 30-day reads sub-100ms on tens of
  millions of events.
- We can add monthly partitioning + materialized views later without
  changing read code; just route the query.

### 1.4 Forecast severity de-dup keyed on (variant, severity)
Without de-dup the daily scheduler would push the same low-stock alert
every morning for weeks. We persist `InventoryForecastAlert` rows with a
unique `(variantId, severity)` constraint. Re-fires happen only on
escalation (WARNING → CRITICAL) or after the seller acknowledges and the
condition re-emerges.

### 1.5 Webhook dispatcher uses Prisma as the queue
No BullMQ, no Redis stream — `SellerWebhookDelivery` IS the queue. The
scheduler reads PENDING + RETRYING rows where `nextAttemptAt <= now()`,
attempts each delivery, marks per result with backoff. This is intentional
for Phase 11 scale (designed for hundreds of deliveries/min, not
thousands). Migration to a real queue is straightforward when volume
demands.

### 1.6 Webhook signature is Stripe-style `t=<ts>,v1=<hmac>`
Two reasons: (1) defends against replay by including a timestamp the
verifier checks for staleness, (2) the format is familiar to anyone who
has built Stripe webhook verification — sellers can paste known-good
verification code with minor tweaks.

### 1.7 Webhook secrets stored encrypted at rest
Reused `KeyCrypto` (AES-256-GCM, Phase 5). The plaintext secret is
returned to the seller exactly once at creation or rotation; we never
display it again. Sellers must save it on first reveal — the UI shows a
"Save this secret now" panel.

### 1.8 Resend chosen as the default email provider
Simplest auth (Bearer token), simplest JSON API. The `EmailProvider`
interface is the integration seam — swapping for SES / Postmark /
SendGrid is one class. Until a buyer adds `RESEND_API_KEY`, the dev
provider logs to stdout.

---

## 2. Issues caught during the post-build pass

### 2.1 `cart.recovery.queued` was referenced but never emitted
`EmailListener.onCartRecovery` listens for `cart.recovery.queued` so the
24h/72h emails fire. `AbandonedCartService.send` was only calling
`NotificationsService.sendToUser` directly for push. Fixed by emitting
the event after the successful push, so email is best-effort and never
blocks the push.

### 2.2 `OrdersService` had no `EventEmitter2` until Phase 11
The service committed orders and called downstream services directly
(shipping, payments) but never emitted `order.placed`. Phase 11 needed
this for seller-analytics ingestion AND webhook fan-out, so we added
`EventEmitter2` to the constructor and emit `order.placed` after the
order's `$transaction` commits. Existing event consumers (notifications,
search index) were unaffected because they listen for `order.paid`, which
the payments service emits on capture.

### 2.3 Catalog + cart services didn't emit view/add events
`CatalogService.getProduct` now emits `product.viewed`. `CartService.addItem`
now emits `cart.item.added`. Both fire-and-forget so analytics failure
can never block the buying flow.

### 2.4 Existing analytics page lived at `/analytics`
Seller portal already shipped a basic analytics page from Phase 4 backed
by `api.seller.analyticsSummary`. To avoid breaking it, the new funnel
+ return-rate dashboard lives at `/analytics/funnel` with a link from
the existing page. A future phase can consolidate them.

### 2.5 `events.emit('order.refunded', ...)` is reused for two paths
The payments service emits this on full gateway refund; the returns
service emits it after committing a refund. The webhook listener treats
both the same way (fires `ORDER_CANCELLED` to the seller). That's
correct for Phase 11 — sellers care that the order won't ship, not
which path triggered the reversal. If we ever need to distinguish, we
add a `reason` field to the payload rather than splitting events.

### 2.6 `EmailService` doesn't fall through to push when a template is missing
`renderTemplate(category, vars)` returns `null` for unknown categories
and `sendToUser` exits cleanly. This is intentional: adding a new push
category requires explicitly opting into the email channel by adding a
template. We don't want to spam buyers with "no template found" emails.

### 2.7 Forecast scheduler clears stale alerts on recovery
If a variant was tagged CRITICAL and the seller restocks (or velocity
drops), the next scheduler run deletes the alert row so the seller
dashboard doesn't show stale red badges. Acknowledged-alerts cleanup is
the same path — if the condition resolves on its own, the row is
removed.

### 2.8 Per-category preference shape is open-ended
The `prefs` JSON is `Record<string, { email?: bool, push?: bool }>`. We
intentionally don't validate the category keys server-side; the UI knows
the canonical list, and a stale key from a removed category just sits
ignored. Adding/removing categories is a frontend-only change.

---

## 3. Wire-up checklist

- `app.module.ts`: `EmailModule`, `SellerAnalyticsModule`,
  `InventoryForecastModule`, `SellerWebhooksModule` registered. Email
  and SellerAnalytics are `@Global` so other modules can inject them.
- `NotificationsService.sendToUser` checks `NotificationPreference.prefs`
  before sending.
- `OrdersService` constructor takes `EventEmitter2`; emits `order.placed`
  after the order $transaction commits.
- `CatalogService.getProduct` emits `product.viewed`.
- `CartService.addItem` emits `cart.item.added`.
- `AbandonedCartService.send` emits `cart.recovery.queued` for email.
- api-client adds 4 endpoint classes:
  `SellerAnalyticsApi`, `SellerWebhooksApi`, `InventoryForecastApi`,
  `PreferencesApi`.
- Seller portal: `/analytics/funnel`, `/inventory/alerts`,
  `/webhooks`, `/webhooks/[id]`. Nav updated.
- Buyer portal: `/account/preferences`. Account-page link added.

## 4. Operational env flags

- `EMAIL_PROVIDER=dev|resend` — defaults to `dev`.
- `RESEND_API_KEY=...` — required for the Resend provider.
- `EMAIL_FROM='Onsective <noreply@onsective.com>'` — sender envelope.
- `PUBLIC_WEB_URL=https://buyer.example.com` — used to build absolute
  URLs in email bodies.
- `INVENTORY_FORECAST_ENABLED=1` — opt in to the daily scheduler.
- `INVENTORY_WARN_DAYS=7`, `INVENTORY_CRITICAL_DAYS=2` — thresholds.
- `SELLER_WEBHOOKS_ENABLED=1` — opt in to the dispatcher scheduler.

## 5. Things deliberately out of scope

- HTML email templates (text-only ship).
- Custom seller email templates / branding.
- SES / SendGrid / Postmark adapters (interface is in place; one
  implementation file each is straightforward to add).
- Email open / click tracking — provider-side analytics only.
- Buyer-level analytics on top of ProductEvent (cohort retention,
  segmentation). Sellers see SKU-level metrics, not buyer journeys.
- Webhook signing v2 (multi-secret rotation window). Today rotation is
  immediate — sellers must update their verifier before triggering the
  next event. Acceptable for Phase 11 scale.
