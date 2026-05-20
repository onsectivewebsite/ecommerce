# Phase 30 — Rate Limiting & Abuse Prevention

Date opened: 2026-05-19
Predecessor: Phase 29 (Stripe Connect Seller Onboarding)

## 1. Why this phase

Twenty-nine phases of feature work and the platform still has
no per-endpoint rate limits. Login forms accept unlimited
credential-stuffing attempts. Promo-code endpoints invite brute
forcing. Data-export requests, payment-method setup intents,
points redemption — every "expensive or sensitive" path is
unrestricted.

Phase 30 adds:

1. A **single rate-limiter service** with Redis as the primary
   backend (already in deps) and an in-memory backend for dev
   environments without Redis.
2. A **`@RateLimit` decorator + `RateLimitGuard`** that any
   controller method can opt into without touching the body.
3. **Per-violation logging** to `AbuseEvent` and **sticky
   `RateLimitBlock`** rows that escalate after repeat violations.
4. **Admin oversight** — view recent abuse events, view + clear
   active blocks.
5. **Coverage** for the eight highest-risk endpoints out of the
   gate; everything else stays unrestricted but the guard is
   trivial to add.

## 2. Scope (in)

### 2.1 RateLimiterService
A single Injectable with two backends behind a small interface:

```
interface RateLimiterBackend {
  tryConsume(key: string, max: number, windowSec: number):
    Promise<{ allowed: boolean; count: number; retryAfterSec: number }>;
}
```

- **RedisBackend**: sliding-window via `INCR` on a key like
  `rl:<ruleId>:<scope>:<resolver>:<windowBucket>` plus
  `EXPIRE windowSec` in a transaction. Bucket = floor(now / windowSec).
  Cheap, atomic, no Lua scripting needed.
- **MemoryBackend**: `Map<key, { count, expiresAt }>` with a
  60s GC sweep. Used when `REDIS_URL` is unset.
- `RateLimiterService.tryConsume(rule, key)` wraps the backend
  and on `!allowed` writes an `AbuseEvent`, increments a
  per-key violations counter (`viol:<rule>:<resolver>`), and
  if violations > 5 inside 10 minutes, auto-creates a
  `RateLimitBlock` for the rule's escalation TTL.

### 2.2 Decorator + Guard
```
@RateLimit({ rule: 'auth.login', max: 10, windowSec: 60, scope: 'ip' })
```
- `scope` values: `ip` | `user` | `ip+user`. The guard resolves
  the actual key via `req.ip` and `req.user?.userId`.
- The guard:
  1. Reads metadata.
  2. Checks for an active `RateLimitBlock` matching the key →
     immediate 429 with `Retry-After` set from `blockedUntil`.
  3. Calls `tryConsume`.
  4. On `!allowed` → 429 with `Retry-After`.
  5. On `allowed` → pass through.
- Headers on every response from a guarded endpoint:
  - `X-RateLimit-Limit: <max>`
  - `X-RateLimit-Remaining: <max - count>`
  - `X-RateLimit-Reset: <unix-seconds>`

### 2.3 Schema
```
enum AbuseEventKind {
  RATE_LIMIT_EXCEEDED
  REPEAT_VIOLATION
  MANUAL_BLOCK
}

enum RateLimitBlockSource { MANUAL, AUTO }

model AbuseEvent {
  id           String   @id
  ruleId       String              // e.g. "auth.login"
  key          String              // the composite key that violated
  kind         AbuseEventKind
  ip           String?
  userAgent    String?
  userId       String?
  requestPath  String?
  createdAt    DateTime @default(now())
  @@index([ruleId, createdAt])
  @@index([key, createdAt])
}

model RateLimitBlock {
  id              String                   @id
  /// composite key — same shape as AbuseEvent.key
  key             String                   @unique
  ruleId          String
  reason          String
  source          RateLimitBlockSource
  /// null = indefinite (admin must clear)
  blockedUntil    DateTime?
  blockedByUserId String?
  createdAt       DateTime                 @default(now())
  updatedAt       DateTime                 @updatedAt
  @@index([blockedUntil])
  @@index([ruleId, createdAt])
}
```

### 2.4 Initial coverage
| Endpoint | Rule id | Max | Window | Scope |
|----------|---------|-----|--------|-------|
| POST /auth/login | `auth.login` | 10 | 60s | ip |
| POST /auth/register | `auth.register` | 5 | 3600s | ip |
| POST /orders/checkout | `orders.checkout` | 5 | 60s | user |
| POST /payment-methods/setup-intent | `payment-methods.setup-intent` | 10 | 3600s | user |
| POST /privacy/data-export | `privacy.data-export` | 3 | 86400s | user |
| POST /loyalty/points/redeem | `loyalty.redeem` | 5 | 3600s | user |
| POST /messages/threads/.../messages | `messaging.send` | 60 | 60s | user |
| POST /promotions/evaluate | `promotions.evaluate` | 30 | 60s | user |

Each rule has an escalation TTL — the auto-block duration on
the 6th violation in 10 minutes. Defaults to 1 hour but
`auth.login` and `auth.register` get 24 hours.

### 2.5 Admin endpoints
- `GET /admin/security/rate-limits/events?ruleId&limit` →
  recent AbuseEvent rows.
- `GET /admin/security/rate-limits/blocks?active=1` → current
  blocks (with auto-expire applied lazily).
- `POST /admin/security/rate-limits/block` body:
  `{ ruleId, key, reason, blockedUntil? }` → manual block.
- `POST /admin/security/rate-limits/unblock` body:
  `{ key }` → deletes the block row.

### 2.6 Admin UI
A panel on the existing admin Security page (Phase 12) showing
abuse events table + active blocks table + manual block form.

## 3. Scope (out)

- **Per-region / per-country routing.** Edge-layer concern.
- **Distributed token-bucket.** Sliding window is sufficient.
- **WAF / Cloudflare bot challenges.** Edge concern.
- **Per-endpoint dynamic config UI.** Rules live in code; ops
  don't tweak them via DB rows.
- **Adjustable escalation thresholds via UI.** Hard-coded
  defaults; revisit after data.
- **Anti-CSRF beyond existing JWT auth.** Out of scope.
- **Captchas / proof-of-work challenges.** Same — edge layer.

## 4. Architectural decisions made up front

### 4.1 Fail open, not closed
If the Redis backend errors (connection drop, replica failover,
etc.) the limiter **fails open** — it allows the request and
logs the failure. A failed-closed default would convert any
Redis blip into a platform outage. Acceptable risk for the
small window: legitimate Redis incidents are operator-visible
via the logs; abuse needs a sustained Redis outage to leak
through.

### 4.2 In-memory backend for dev parity
We don't require Redis to develop the API. `MemoryBackend`
ships with the same interface; the integration tests and the
dev `pnpm dev` flow work without Redis. Production has Redis;
staging has Redis. The backends are wire-compatible up to
multi-instance — in-memory loses counters across pod replicas,
which is fine for dev.

### 4.3 Sliding window via bucket, not log
Stripe-style "remember every request timestamp and prune" is
O(N) per check. We use a simple bucket per `windowSec` —
slightly less precise (a request at second 59 and one at
second 61 of the same logical "minute" hit different buckets)
but O(1) per check and adequate for abuse prevention. The
imprecision in our favor at boundaries doesn't change the
order of magnitude.

### 4.4 AbuseEvent writes are best-effort
A failed DB write doesn't block the 429 response. We log and
move on. The block table still gets written transactionally
when an escalation triggers, so the only loss is auditability,
not enforcement.

### 4.5 RateLimitBlock is the override
The block table is checked **before** the counter. A blocked
key 429s immediately without consuming a counter slot. This
also means a `MANUAL` block can preempt the auto-block escalation
path for known-bad keys (e.g., admin observes a scraping IP,
manually blocks it for 7 days).

### 4.6 Key shape
`<ruleId>:<scope>:<resolver>`:
- `auth.login:ip:203.0.113.42`
- `orders.checkout:user:u_abc123`
- `messaging.send:ip+user:203.0.113.42|u_abc123`

The ruleId prefix means one user blocked on auth.login is not
blocked on orders.checkout. We rate-limit per concern, not per
identity.

### 4.7 Auto-block escalation = 6 violations / 10 min
A burst of three retries on a real network glitch shouldn't
escalate. Six violations across ten minutes is "abusive
pattern" territory. The threshold is hard-coded; revisit
after seeing real data.

### 4.8 No rate limit on the rate-limit endpoints themselves
The admin block / unblock endpoints aren't rate-limited.
They're admin-only and the access pattern is human-scale.

### 4.9 Headers always set, even when allowed
Every response from a guarded endpoint includes the three
`X-RateLimit-*` headers. Lets clients self-throttle without
needing to handle 429s reactively.

## 5. Acceptance criteria

- POST `/auth/login` 11 times in 60s from one IP → 11th
  response is 429 with `Retry-After` set. `AbuseEvent`
  written.
- Continue hammering past 5 more violations → on the 6th
  violation a `RateLimitBlock` row appears with
  `source=AUTO` and `blockedUntil = now + 24h`. Subsequent
  requests get 429 immediately without consuming a counter
  slot.
- Admin `POST /admin/security/rate-limits/unblock { key }`
  → block row deleted; the IP can log in again (subject to
  the counter).
- Disable Redis (or run with `REDIS_URL` unset) → the
  in-memory backend takes over; identical behavior on a
  single replica.
- Crash Redis mid-test → the next request fails open; a
  warning is logged.
- `X-RateLimit-Limit / Remaining / Reset` headers appear on
  guarded endpoints on every response.
- `/admin/security/rate-limits/events` lists the abuse
  events with their ruleId + key + ip.
- `doc/phase-30-debug.md` captures decisions + limitations.
