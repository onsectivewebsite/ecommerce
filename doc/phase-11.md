# Phase 11 — Seller Success Suite

Date opened: 2026-05-18
Predecessor: Phase 10 (Buyer Growth Engine)

## 1. Why this phase

Phases 1–9 made the marketplace functional; Phase 10 added the buyer
engagement loop. Sellers, however, still operate with primitive tools:
no real analytics beyond raw order counts, no advance warning when SKUs
are about to deplete, no way to integrate with their own ERP/3PL systems,
and an out-of-platform email channel that doesn't exist (we only ship
push notifications).

Phase 11 closes those gaps with four tightly-related modules:

1. **Transactional Email** — a pluggable email pipeline that mirrors the
   push notification system so every buyer/seller-facing event has both a
   push and an email path, gated by per-category user preferences.
2. **Seller Analytics** — funnel metrics (view → add → purchase), AOV
   trends, return rate per SKU, conversion rate, top products.
3. **Inventory Forecasting** — velocity-based depletion projections plus
   "low-stock projected in N days" alerts to the seller.
4. **Seller Webhooks** — sellers register their own HTTPS endpoints and
   receive signed payloads on domain events (`order.placed`, `order.paid`,
   `shipment.delivered`, `return.requested`, etc.) so they can wire the
   marketplace into their existing systems.

## 2. Scope (in)

### 2.1 Transactional Email
- `EmailProvider` interface with `SesEmailProvider` (real) and
  `DevEmailProvider` (logs to stdout for dev/CI).
- Templating engine (Handlebars-style placeholders, no external dep).
- `NotificationPreference` table — one row per user; opt-out flags per
  category (`order_paid`, `shipment_delivered`, `return_approved`,
  `wishlist_price_drop`, etc.). Default: opted in.
- Listener (`EmailListener`) mirrors `NotificationsListener` event-by-event
  so adding a new push category requires adding the matching email
  template, not new wiring.
- Buyer preferences page under `/account/preferences` to toggle categories.

### 2.2 Seller Analytics
- `ProductEvent` table — one row per analytics-relevant event
  (`VIEW`, `ADD_TO_CART`, `PURCHASE`). Schema is partitioned-friendly
  (by `occurredAt` day) but Phase 11 lives in a single table; we'll
  shard later when volume justifies it.
- Catalog service emits `VIEW` events from PDP fetches; cart service
  emits `ADD_TO_CART`; orders service emits `PURCHASE` on commit.
- `SellerAnalyticsService` produces:
  - Top products by revenue (30d / 90d)
  - Funnel: views → adds → purchases per SKU
  - AOV trend (daily bucket, 30d)
  - Return rate per SKU
  - Overall conversion rate
- All queries return roll-ups; no per-event leak to seller dashboard.

### 2.3 Inventory Forecasting
- Daily scheduler computes per-variant velocity: `purchases_last_14d / 14`.
- For each variant, project `daysUntilEmpty = inventoryQty / velocity`.
- If `daysUntilEmpty < threshold` (default 7) AND `velocity > 0`, write/
  upsert an `InventoryForecastAlert` row and push a notification to the
  seller. De-dupe by `(variantId, level)` so the seller isn't paged daily.

### 2.4 Seller Webhooks
- Sellers register up to 5 HTTPS endpoints with a name, URL, subscribed
  event list, and an auto-generated `secret`.
- Dispatcher signs payload with `HMAC-SHA256(secret, body)` and sends as
  `X-Onsective-Signature: sha256=<hex>`. Includes `X-Onsective-Event`
  header and idempotency key.
- Failed deliveries (non-2xx, network error) retry with exponential
  backoff: 1m, 5m, 30m, 2h, 8h, 24h. Max 6 attempts; after that the
  delivery is marked DEAD and the seller is notified once.
- Each delivery is logged in `SellerWebhookDelivery` for debugging.

## 3. Scope (out)

- HTML email designer for sellers — Phase 11 emails come from a fixed
  template set. Custom templates are a future phase.
- Slack / Discord webhooks — only generic HTTPS supported. A separate
  Slack-app integration can layer on top.
- ML-driven demand forecasting — Phase 11 uses simple 14-day velocity.
  ARIMA / Prophet / LLM forecasting is a future phase.
- Buyer behavior analytics on top of `ProductEvent` (e.g., cohort
  retention by buyer segment) — sellers see SKU-level metrics, not
  individual buyer journeys.
- Webhook delivery to non-HTTPS URLs.

## 4. Architectural decisions made up front

### 4.1 `ProductEvent` is event-sourced, not pre-aggregated
We write one row per event and aggregate at read time. Reasons:
- Avoids the "rollup got out of sync with the source" class of bug.
- A single Postgres index on `(productId, occurredAt)` is fast enough
  for the seller dashboard's 30-day window.
- When the table grows past ~50M rows we'll add monthly partitioning
  + materialized views; for now the simple model wins.

### 4.2 Email and push are siblings, not a unified channel
The `NotificationPreference` table has separate `emailEnabled` and
`pushEnabled` flags per category. A buyer can mute push for
`wishlist_price_drop` and still get the email, or vice versa. This is
the standard pattern from major e-commerce platforms (Amazon, eBay) and
avoids the failure mode where muting "shipment updates" silences both
channels and a buyer misses a real delivery exception.

### 4.3 Webhook dispatcher uses Prisma as the queue
Rather than introducing BullMQ or a separate queue infra in this phase,
the `SellerWebhookDelivery` table IS the queue. A scheduler reads
PENDING + DUE deliveries every minute, attempts them, marks DELIVERED /
RETRYING / DEAD. This is intentionally low-throughput (designed for
hundreds of deliveries/minute, not thousands) — we'll move to a real
queue when seller webhook volume justifies it.

### 4.4 Webhook secrets are stored encrypted at rest
We reuse the AES-256-GCM helper from Phase 5 (digital license keys) to
encrypt the secret column. Sellers see the plaintext secret once at
endpoint creation and never again. Rotation generates a new secret and
returns it.

### 4.5 Forecasting alerts have severity levels
- `WARNING` — projected to empty in ≤7 days at current velocity.
- `CRITICAL` — projected to empty in ≤2 days OR already at 0 with active
  velocity.
- We push at most one alert per (variant, severity, week) to avoid
  pager fatigue.

## 5. Acceptance criteria

- Buyer sees `/account/preferences` and can toggle email + push per
  category. A muted category does not trigger the corresponding channel.
- An order paid event sends both a push and an email (unless muted).
- Seller analytics dashboard shows top products, funnel, AOV trend, and
  return rate using real data.
- A SKU about to deplete generates a notification + an
  `InventoryForecastAlert` row visible in the seller's "Low stock" view.
- Seller can create a webhook endpoint, see it deliver real events with
  a valid HMAC signature, view delivery history with retry attempts.
- `phase-11-debug.md` captures non-obvious decisions and the post-build
  debug findings.
