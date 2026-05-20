# Phase 30 — Debug Pass

Companion to `phase-30.md`. Decisions made, seams to watch, what to
test before merging.

## 1. The invariants Phase 30 preserves

1. **Fail-open.** Any infrastructure error in the limiter
   (Redis down, DB write fails, etc.) lets the request through
   with a logged warning. A failed-closed default would convert
   any Redis blip into a platform outage; that's worse than a
   short window of un-throttled traffic.
2. **Block table is the source of truth for "blocked".** The
   guard checks `RateLimitBlock` **before** the counter. A
   blocked key 429s immediately without consuming a counter
   slot.
3. **`AbuseEvent` writes are best-effort.** A failed write
   doesn't change the 429 — the user still gets rate-limited;
   only the audit log loses an entry.
4. **`AUTO` block upserts on the unique key.** Repeat
   escalation across the threshold doesn't create duplicate
   block rows; it just refreshes `blockedUntil`.
5. **Limiter headers are set on every guarded response.**
   `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
   `X-RateLimit-Reset` are emitted on allowed responses too, so
   clients can self-throttle without waiting for 429s.

## 2. Non-obvious decisions

### 2.1 Bucket sliding window, not log
Tracking every request timestamp + pruning is O(N). We use a
simple per-`windowSec` bucket. Slightly less precise at window
boundaries (two requests one second apart can land in different
buckets and "reset" the counter) but O(1) per check and good
enough for abuse prevention. The slack at boundaries is in the
attacker's favor by at most one window's worth of requests —
acceptable trade-off for the runtime cost saved.

### 2.2 In-memory backend for dev parity
Production gets `REDIS_URL`. Dev usually doesn't. The
`MemoryBackend` ships with the same interface; dev keeps
working, integration tests don't need Redis. Multi-replica
production loses counter-sharing across pods in this mode —
hence Redis is mandatory in prod.

### 2.3 No Lua scripts, just MULTI+EXEC
ioredis pipeline `INCR` + `PEXPIREAT` is atomic enough for our
purposes and stays simple to reason about. A Lua script would
give us conditional-by-count semantics for free but adds
deployment surface (the script has to be loaded into every
Redis instance). We keep the implementation in pure JS.

### 2.4 Key composition: rule + scope + resolver
`auth.login:ip:203.0.113.42`. The rule prefix means a user
blocked on `auth.login` is not blocked on `orders.checkout` —
we rate-limit per concern, not per identity. The scope tag
lets the admin disambiguate IP-only blocks from user-only
blocks in the table.

### 2.5 Auto-block escalation at 6 violations / 10 minutes
A burst of three retries on a real network glitch shouldn't
escalate. Six violations across ten minutes is "abusive
pattern" territory. Auth rules get a 24-hour auto-block (longer
because the abuser is more likely credential-stuffing); other
rules get 1 hour.

### 2.6 Promo-code rate limit folded into orders.checkout
We considered a separate `promotions.evaluate` rule but
promo-code application only happens server-side inside
`OrdersService.checkout`. The existing checkout rule (5/min
per user) is the natural choke point — there's no buyer-facing
evaluate endpoint to gate independently.

### 2.7 No rate limit on the rate-limit endpoints themselves
The admin block / unblock endpoints aren't limited. They're
admin-only and accessed at human cadence.

### 2.8 IP resolution prefers `req.ip`, falls back to XFF first hop
We trust the Express `req.ip` which respects the `trust proxy`
config. Behind a load balancer this resolves to the X-Forwarded-For
chain's leftmost entry. We additionally accept an XFF header
fallback for environments where `trust proxy` isn't configured
yet.

### 2.9 user-scope on an unauth request falls through
The guard doesn't 429 a missing user — that's the auth guard's
job. We pass through and let the downstream JwtAuthGuard reject
with 401. Avoids confusing 429s on what's really an auth issue.

### 2.10 Block lazy-expires on read
`activeBlock(key)` deletes any block whose `blockedUntil` has
passed before returning null. Saves a background sweeper. The
admin "active blocks" listing also filters server-side.

## 3. Things to test end-to-end

- POST `/auth/login` 11 times in 60s from one IP →
  the 11th response is 429 with `Retry-After`. Headers
  `X-RateLimit-Limit: 10`, `X-RateLimit-Remaining: 0`,
  `X-RateLimit-Reset: <ts>` set on both allowed and the
  rejected response. An `AbuseEvent` row exists.
- Hammer past 5 more violations within 10 minutes → on the
  6th violation a `RateLimitBlock` row appears with
  `source=AUTO` and `blockedUntil = now + 24h`. Subsequent
  requests get 429 immediately without incrementing the
  counter.
- Admin `POST /admin/security/rate-limits/unblock { key }`
  → block row deleted; the IP can log in again (subject to
  the counter).
- Set `REDIS_URL` to a bogus address → `RateLimiterService`
  warns on init but the platform doesn't crash; in-memory
  fallback isn't auto-selected, but `check()` fails open on
  every error and requests pass through with a warning per
  failure.
- Unset `REDIS_URL` → in-memory backend takes over; identical
  behavior on a single replica.
- POST `/auth/register` 6 times in an hour → 6th is 429.
- POST `/orders/checkout` 6 times in 60s as one user → 6th
  is 429. A second user from the same IP is unaffected (scope
  is `user`).
- POST `/payment-methods/setup-intent` 11 times in an hour as
  one user → 11th is 429.
- POST `/privacy/data-export` 4 times in 24h as one user →
  4th is 429.
- POST `/loyalty/points/redeem` 6 times in an hour as one user
  → 6th is 429.
- POST `/messaging/threads/:id/messages` 61 times in 60s as
  one user → 61st is 429.
- Manual block via the admin form → block row appears with
  `source=MANUAL`; the user can't access the endpoint at all
  until unblocked.
- `/admin/rate-limits` page renders both tables; filter by
  rule id narrows events.

## 4. Known limitations

- **No edge-layer rate limiting.** Pure application-level. A
  WAF / CDN would absorb attacks before they hit the API.
  Out of scope.
- **Bucket boundary slack.** See §2.1. Worst case is roughly
  one window's worth of "extra" requests at the boundary.
- **No per-key history view.** Admin can search events by
  rule id; per-key drill-down would help triage but is a
  follow-up.
- **No "unblock all" / "unblock by rule" bulk action.** One
  key at a time.
- **No alerting on auto-blocks.** A future polish pass could
  wire a notification to admin (Slack / email) when an
  auto-block fires.
- **In-memory backend loses counters on restart.** Accepted —
  it's the dev fallback only.
- **Cross-replica counter-sharing requires Redis.** In-memory
  mode in a multi-replica deploy is broken-by-design (each
  replica has its own counter). Don't do that.
- **No GraphQL coverage.** We only have REST controllers
  today; the decorator works on any Nest handler so it would
  cover GraphQL resolvers if/when added.

## 5. Files added

- `services/api/src/modules/rate-limit/backends.ts`
- `services/api/src/modules/rate-limit/rate-limiter.service.ts`
- `services/api/src/modules/rate-limit/rate-limit.decorator.ts`
- `services/api/src/modules/rate-limit/rate-limit.guard.ts`
- `services/api/src/modules/rate-limit/rate-limit-admin.controller.ts`
- `services/api/src/modules/rate-limit/rate-limit.module.ts`
- `packages/api-client/src/endpoints/rate-limits.ts`
- `apps/admin-web/src/app/rate-limits/page.tsx`

## 6. Files edited

- `services/api/prisma/schema.prisma` — added
  `AbuseEvent`, `RateLimitBlock`, and two enums.
- `services/api/src/app.module.ts` — registered
  `RateLimitModule`.
- `services/api/src/modules/auth/auth.controller.ts` —
  `@RateLimit` on `register` (5/hr ip) + `login` (10/min ip).
- `services/api/src/modules/orders/orders.controller.ts` —
  `@RateLimit` on `checkout` (5/min user).
- `services/api/src/modules/payments/payment-methods.controller.ts`
  — `@RateLimit` on `setup-intent` (10/hr user).
- `services/api/src/modules/loyalty/loyalty.controller.ts` —
  `@RateLimit` on `redeem` (5/hr user).
- `services/api/src/modules/privacy/privacy.controller.ts` —
  `@RateLimit` on `data-export` (3/day user).
- `services/api/src/modules/messaging/messaging.controller.ts`
  — `@RateLimit` on send (60/min user).
- `packages/api-client/src/index.ts` — re-export `rate-limits`.
- `apps/admin-web/src/lib/api.ts` — wired
  `AdminRateLimitsApi`.
- `apps/admin-web/src/components/Shell.tsx` — added
  `/rate-limits` nav.

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_30_rate_limits
pnpm -r typecheck
pnpm -r build
```

Required env (optional — in-memory fallback works without
Redis):

```
REDIS_URL=redis://localhost:6379    # production-grade backend
```

The migration adds two new tables (`AbuseEvent`,
`RateLimitBlock`), two new enums. No backfill needed.
