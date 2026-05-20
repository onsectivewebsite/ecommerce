# Phase 12 — Trust, Safety & Operations

Date opened: 2026-05-18
Predecessor: Phase 11 (Seller Success Suite)

## 1. Why this phase

The marketplace now processes real payments, holds wallet balances, ships
physical goods, and processes refunds and chargebacks. Every prior phase
added a vector for either fraud loss or operational incident:

- Promotions + wallet → bonus farming, stacking abuse
- Returns + STORE_CREDIT → wardrobing, refund-then-resell schemes
- Seller webhooks → outbound HTTPS with sensitive PII
- Per-seller commissions + payouts → reverse-payout window risk

What's missing is the defensive layer: scoring high-risk orders, detecting
account takeover, tracking seller-side risk over time, and the SRE
fundamentals (request-scoped trace IDs, structured logs, metrics) that
let us actually diagnose incidents when they happen.

Phase 12 ships four interlocking pieces:

1. **Risk engine** — pluggable rule chain scores every order at checkout.
   Hits above the auto-hold threshold pause the order in `ON_HOLD` and
   surface in the admin risk-review queue.
2. **Account security** — login event capture with device + IP +
   coarse geo, anomaly detection (new device, impossible travel),
   step-up challenge gate for sensitive actions.
3. **Seller health score** — daily snapshot of a composite metric
   (dispute / chargeback / return / SLA rates). Below a threshold the
   seller is paused; above the threshold the seller dashboard shows the
   trajectory.
4. **Observability foundation** — request-scoped trace IDs propagated
   through logs, JSON log formatter, `/metrics` Prometheus endpoint
   exposing counters and gauges for the things you'd actually page on.

## 2. Scope (in)

### 2.1 Risk engine
- `RiskRule` interface: `evaluate(ctx) → { score, code, reason }`.
- Built-in rules:
  - `velocity-orders` — >5 orders/24h from same user.
  - `velocity-payments` — >3 distinct cards used in 24h.
  - `billing-shipping-country-mismatch` — flag if billing and shipping
    countries differ.
  - `new-account-high-value` — account < 24h old + order total > $500.
  - `wallet-bonus-farming` — promo-only orders that immediately request
    a refund within 7 days (post-fact rule, runs daily).
  - `return-rate-trend` — buyer with > 30% lifetime return rate (post-fact).
- Score range 0–100. Default threshold `RISK_HOLD_THRESHOLD=60`.
- `RiskAssessment` row per order with total score, rule hits, decision
  (`ALLOW` / `HOLD` / `BLOCK`).
- `OrderHold` row when an order is held — admin review queue clears it
  (release or cancel).
- Block decisions (score ≥ 90) refuse the order with a generic
  `OrderRefusedError` (we don't leak the rule details to attackers).

### 2.2 Account security
- Every successful login (or refresh) writes a `LoginEvent` with hashed
  IP, user-agent fingerprint, optional coarse geo (from IP-2-country
  service when configured), and a "trusted" flag.
- Anomaly detector compares current login against the last N events:
  - New device (UA fingerprint never seen) → require step-up next time
    a sensitive action runs.
  - Country change in < 2 hours from a different country → flag as
    "impossible travel", invalidate all sessions, require re-auth + email.
- `StepUpChallenge` table: short-lived one-time tokens emailed to the
  account email; consumed before the gated action runs.
- Sensitive actions gated by step-up:
  - Wallet withdrawal (future) or large wallet-funded checkout
  - Webhook secret rotation
  - Bulk product publish or bulk price update
  - Password change

### 2.3 Seller health score
- Composite of (dispute rate, chargeback rate, return rate, support SLA
  breach rate). Weighted; range 0–100 where 100 = perfect.
- Daily scheduler writes a `SellerHealthSnapshot` row per active seller.
- Below `SELLER_HEALTH_PAUSE_THRESHOLD=40` the seller is set
  `status=SUSPENDED` and an admin alert + email fires.
- Dashboard surfaces the last-30-days trend to the seller (and to admin
  with finer breakdown).
- Health score is also exposed to the risk engine: a seller with low
  health amplifies the risk score of their orders (anti-mule
  marketplace).

### 2.4 Observability foundation
- `TraceMiddleware`: reads `x-trace-id` from incoming requests or mints
  one (ULID), attaches to AsyncLocalStorage so the logger can include it.
- `JsonLogger`: structured log entries with `{ts, level, msg, traceId, ctx, …}`.
- `/metrics` endpoint, Prometheus text format. Counters:
  - `onsective_orders_total{status}`
  - `onsective_risk_decisions_total{decision}`
  - `onsective_logins_total{outcome}`
  - `onsective_webhook_deliveries_total{status}`
  - `onsective_email_sends_total{provider,status}`
- Gauges:
  - `onsective_held_orders` (current count of ON_HOLD orders)
  - `onsective_active_sellers`
- `/metrics` is behind a token (`METRICS_TOKEN` header check). Public
  unauth scraping would leak business data.

## 3. Scope (out)

- 3D-Secure / SCA enforcement beyond what Stripe handles for us.
- WAF-style request inspection (rate limiting per route, bot detection).
  That's edge-layer infrastructure; Phase 12 is application-layer.
- Distributed tracing (OpenTelemetry exporters, Jaeger, etc.). We ship
  request-scoped trace IDs in logs; OTel exporter wiring is a future
  follow-up.
- ML-driven fraud detection. The rule engine is intentionally rule-based
  and explainable. Models layer on top in a future phase if signals
  justify it.
- KYC / identity verification document workflows (already exist in
  Phase 5 ComplianceModule for seller-side; buyer-side KYC for
  high-value markets is a future phase).

## 4. Architectural decisions made up front

### 4.1 Risk engine is a pure function over a context object
`RiskRule.evaluate(ctx)` does not have side effects. The engine collects
hits, sums scores, and writes a single `RiskAssessment` row. This makes
the rules trivially testable and the decision auditable — given the same
context, the same rules produce the same score forever.

### 4.2 OrderHold is a separate table from Order.status
We could overload `OrderStatus` with `HELD_FOR_REVIEW`. We don't: holds
are a transient operational state distinct from the order lifecycle, and
keeping them in a sibling table means we can hold orders that are
already `PAID` (e.g., post-capture review) without rewriting the
state machine. When admin releases the hold, the Order continues from
its actual lifecycle state.

### 4.3 LoginEvent stores hashed IP, not raw
`hashedIp = sha256(salt + ip)` with a per-deploy salt. We can group by
IP for velocity rules without retaining raw IPs longer than the
abandon-cart's data-minimization window. Geo is coarse (country code
only) — we never store city/lat/long.

### 4.4 Step-up uses one-time email tokens, not TOTP
The Phase 12 spec deliberately ships email-only step-up. TOTP / WebAuthn
requires UX work in all four portals plus account-recovery flows; both
are good but properly scoped to a future security-deepening phase. The
email-token primitive serves the highest-leverage gates today.

### 4.5 SellerHealthSnapshot is point-in-time, not derived on read
We could compute health on every read; we don't because (a) the heavy
queries (dispute counts, return-rate joins) are expensive to fan across
all sellers concurrently, and (b) point-in-time snapshots give us a
trend line we can chart. The scheduler is the single computer; the API
is a read of the most-recent snapshot.

### 4.6 `/metrics` is gated by a shared-secret header
Prometheus scrapers send `Authorization: Bearer <METRICS_TOKEN>`. We do
not expose `/metrics` to the public internet under any circumstance.
The token is rotated quarterly per the runbook.

## 5. Acceptance criteria

- A buyer placing an order with mismatched billing/shipping country sees
  the order go through but lands in admin review with a `RiskAssessment`
  showing the rule hit and contributing score.
- Admin can release or cancel a held order from `/admin/risk`.
- A login from a brand-new device generates a `LoginEvent` flagged as
  new-device; the next sensitive action prompts the step-up flow.
- Issuing a wallet withdrawal (future) or rotating a webhook secret
  requires step-up if the actor has unverified-device sessions.
- The seller dashboard shows a health-score gauge + 30d trend.
- `/metrics?token=…` returns Prometheus text with the documented
  counters and gauges, non-empty after a handful of requests.
- `phase-12-debug.md` captures the build decisions and post-build
  findings.
