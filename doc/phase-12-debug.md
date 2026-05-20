# Phase 12 — Debug & Wire-Up Notes

Date: 2026-05-18

Phase 12 added the defensive layer: order risk scoring, account-security
event capture + step-up gate, daily seller health snapshots with
auto-suspend, and the observability foundation (trace IDs, JSON logs,
Prometheus `/metrics`). This doc captures the design decisions made
during the build and what the post-build pass caught.

---

## 1. Decisions captured during the build

### 1.1 Risk rules are pure functions, persisted as data
`RiskRule.evaluate(ctx)` is side-effect-free; it returns a `RiskHit` or
null. The engine sums scores, decides ALLOW/HOLD/BLOCK by thresholds,
and writes a single `RiskAssessment` + N `RiskRuleHit` rows. Adding a
rule is a new class with `@Injectable()` and a line in the module's
provider list — no engine changes.

Tested-by-construction: given the same context, the same rules produce
the same score forever. Audit and replay are trivial.

### 1.2 OrderHold is sibling to Order, not a status overload
We could have added `HELD_FOR_REVIEW` to `OrderStatus`. We didn't:
holds are a transient operational state — an order can be `PAID` and
still on hold for post-capture review. When admin releases the hold,
the order continues from its actual lifecycle state (and we re-emit
`order.paid` so shipping resumes — see 2.1 below).

### 1.3 LoginEvent stores `sha256(salt + ip)`, not raw IPs
Salt comes from `LOGIN_IP_SALT`. We can still group by IP for velocity
detection without keeping personally-identifiable IPs around longer
than the table's retention window. Geo is coarse — country code only,
never city / lat / long.

### 1.4 UA fingerprint normalizes version numbers
A Chrome 124 → 125 update should not trigger a "new device" alert on
every patch. The fingerprint hashes the lowercased user-agent with all
numeric runs replaced by `X`, so `Chrome/125.0.0.0` and
`Chrome/124.0.0.0` collapse to the same fingerprint.

### 1.5 Step-up uses one-time email codes, not TOTP
Phase 12 ships email-only step-up. TOTP / WebAuthn require UX work in
all four portals plus recovery flows; both are out of scope. The
email-token primitive serves the highest-leverage gates today and the
interface (`SecurityService.requireStepUp`) is provider-agnostic so we
can swap implementations later.

### 1.6 Step-up codes are bound to challenge id, not just code
`tokenHash = sha256(challengeId + ':' + code)`. This prevents a leaked
6-digit code from being replayed against a different challenge row.

### 1.7 SellerHealthSnapshot is point-in-time, not derived on read
Two reasons: (a) the underlying counts (disputes, returns, SLA breaches)
are expensive to fan across all sellers concurrently; (b) we want a
trend chart, which requires historical points anyway. The scheduler is
the only writer; the API reads the most recent row.

### 1.8 Auto-suspend has a 5-order floor
A brand-new seller with one returned package would otherwise drop to a
sub-40 health score and get auto-paused. The floor (`ordersConsidered
>= 5`) prevents that footgun. Once the seller has any meaningful
volume, the threshold applies.

### 1.9 `/metrics` is gated by a shared-secret token
`METRICS_TOKEN` env var (no token = endpoint refuses with 403). Public
unauthenticated scraping would leak business data — held-order count
alone is a signal an attacker would use to time their next attempt.

### 1.10 Metrics are in-process, not prom-client
Avoiding the prom-client dep keeps the footprint small. Counters +
gauges with a hand-rolled Prometheus text serializer are enough for
Phase 12. When we need histograms or push-gateway support we'll swap.

### 1.11 JsonLogger opt-in via `LOG_FORMAT=json`
Production turns it on; dev keeps Nest's pretty colored logger. The
trace-id is read from AsyncLocalStorage at log time, so even logs from
inside `setTimeout` or event-listener callbacks carry the originating
request's trace id.

---

## 2. Issues caught during the post-build pass

### 2.1 Held orders silently skipped shipping; admin release had to re-fire
The original cut just blocked label creation on held orders. After
admin release, nothing re-triggered the shipping flow — orders would
stay paid forever with no label. Fixed by emitting `order.paid` again
from `RiskService.release` when the order is already PAID. Idempotent
downstream consumers handle the second emission gracefully.

### 2.2 `OrdersService.checkout` had a duplicate `buyer` lookup
After inserting the risk-scoring block (which needs `buyer.createdAt`),
the original `buyer` lookup further down for payment intent creation
became dead code that re-queried the same row. Consolidated to one
lookup at the top of the post-transaction section.

### 2.3 Auth + Security circular-import risk
`SecurityService` (security module) injects `EmailService` (email
module, global). `AuthController` (auth module) injects
`SecurityService`. Both `SecurityModule` and `EmailModule` are
`@Global()`, so no explicit imports are required and there's no cycle.

### 2.4 `AuthService.findByEmail` was missing
The failed-login event capture needs to resolve email → userId to write
a `LoginEvent`. AuthService had no public helper for this; added
`findByEmail(email)` that re-uses the lowercased lookup logic.

### 2.5 Block decision needed inventory rollback
A risk BLOCK decision after the order $transaction had already
decremented inventory. We now roll back: cancel the order, increment
the variant qty back. Buyers see a generic "We are unable to process
this order" message — we never leak which rule fired (anti-probe).

### 2.6 Cloudflare-style country header support
Login event capture reads `cf-ipcountry` from the request headers. If
the deployment is behind a different proxy (AWS ALB, Fastly), the
header name differs. The reader falls back to `undefined` if the
header is absent, so anomaly detection just runs without geo context —
no crash.

### 2.7 Step-up gate is BadRequestException, not 401/403
The first call returns `{ code: STEP_UP_REQUIRED, challengeId }` with
a 400 so frontends can render the input prompt without triggering the
401 re-auth redirect. Resubmitting with `challengeId` + `code`
verifies and proceeds.

### 2.8 SellerHealthSnapshot `distinct` query
The admin list uses `distinct: ['sellerId']` so we return the latest
snapshot per seller rather than every historical row. Combined with
`orderBy: [{ score: 'asc' }, { capturedAt: 'desc' }]` this returns the
worst-currently-scored sellers first.

### 2.9 EmailService templates extended with security categories
Added `security_sign_in_alert`, `security_step_up_code`, and
`seller_health_low` templates to `templates.ts` — these are needed by
Phase 12 flows. Adding more is a one-line addition to the inline
registry.

---

## 3. Wire-up checklist

- `app.module.ts`: `ObservabilityModule`, `SecurityModule`, `RiskModule`,
  `SellerHealthModule` registered. Risk + Security are `@Global`.
- `main.ts`: optional `JsonLogger` when `LOG_FORMAT=json`.
- `OrdersService.checkout` injects `RiskEngine`; scores after $transaction
  commit; rolls back on BLOCK.
- `ShippingService.onOrderPaid` checks `OrderHold` before purchasing the
  label.
- `RiskService.release` re-emits `order.paid` when the order is already
  PAID.
- `AuthController` injects `SecurityService`; captures success +
  failure login events with hashed IP and UA fingerprint.
- api-client adds 3 classes: `RiskApi`, `SellerHealthApi`, `SecurityApi`.
- Admin portal: `/risk` queue + `/risk/[id]` detail + `/seller-health`
  list. Nav updated.
- Seller portal: `/health` dashboard with score, signals, focus areas,
  30d trend. Nav updated.
- Buyer portal: `/account/security` activity log. Account-page link added.

## 4. Operational env flags

- `RISK_HOLD_THRESHOLD=60` — score at which orders go to HOLD.
- `RISK_BLOCK_THRESHOLD=90` — score at which orders are refused outright.
- `LOGIN_IP_SALT=…` — per-deploy salt for hashed login-IP storage.
- `SELLER_HEALTH_ENABLED=1` — opt in to the daily scheduler.
- `SELLER_HEALTH_PAUSE_THRESHOLD=40` — auto-suspend cutoff (with 5-order floor).
- `LOG_FORMAT=json` — emit structured logs with trace IDs.
- `METRICS_TOKEN=…` — required for `/metrics`. Without it, the endpoint
  returns 403.

## 5. Things deliberately out of scope

- 3D-Secure / SCA enforcement beyond what Stripe already does for us.
- WAF / per-route rate limiting (edge-layer concern, not application).
- OpenTelemetry distributed-trace exporter. We propagate trace IDs in
  logs; OTel wire-up is a follow-up.
- ML-based fraud detection. The rule engine is intentionally
  rule-based and explainable; models layer on top later.
- TOTP / WebAuthn step-up. Provider-agnostic interface is in place; a
  future security-deepening phase adds them.
- Buyer KYC for high-value markets (seller-side KYC already exists in
  Phase 5 ComplianceModule).
