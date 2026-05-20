# Phase 32 — Cookie Consent & Marketing Preferences — Debug Pass

> Walk-through of what shipped, the invariants that hold, every entry point, and the deferred follow-ons.

## What shipped

- **One ConsentRecord per identity** (logged-in user XOR anonymous browser session). `@unique` on both `userId` and `anonId` enforces that; mixing both on a single capture is normalized to "user wins" inside the service.
- **Region detection** from Cloudflare/Vercel/Fastly country headers, US state header, then Accept-Language; bucketed to `EU | UK | CA | REST`. Captured once at first record creation and never re-bucketed thereafter.
- **Anonymous-to-user fold** runs in AuthController on register, login (no-2FA path), and `/auth/2fa/verify`. If the user has no record, we re-key the anon row to the user; if both exist, the user row wins and the anon row is deleted. Best-effort — failures never block the auth flow.
- **Five capture surfaces** route through the same `ConsentService.capture` and produce a `ConsentEvent` audit row + an `AuditService.record` entry per write:
  - `BANNER` (cookie banner, anon or user)
  - `PREFERENCES_PAGE` (PATCH /privacy/preferences)
  - `UNSUBSCRIBE_LINK` (one-click email link)
  - `ADMIN_OVERRIDE` (reserved; no UI yet)
  - `IMPORT` (reserved)
- **Email gating** ties everything together. `templateKind(category)` returns `marketing` for `wishlist_price_drop`, `wishlist_back_in_stock`, `cart_recovery_24h`, `cart_recovery_72h`; everything else (orders, shipping, security, billing, returns, disputes, messages) is `transactional` and bypasses the consent check.
- **One-shot unsubscribe tokens.** Per-send, 90-day TTL, opaque random + sha256 storage. Consuming flips the right column to `false` and records an `UNSUBSCRIBE_LINK` event. Token is single-use; re-clicking returns `alreadyDone: true`.

## Invariants

1. **Transactional sends are never blocked by marketing consent.** Order receipts, shipping updates, payouts, security alerts, billing notices all use `sendToUser` but pass through the gate untouched because their template kind is `transactional`.
2. **Marketing send requires positive consent.** `marketing === true && marketingEmail === true` on the ConsentRecord. Missing record = no marketing send. Period.
3. **Banner re-prompts only on policy-version mismatch.** A captured record at `policyVersion: "2026-05-19"` doesn't re-show the banner until `CONSENT_POLICY_VERSION` env is bumped.
4. **Anon cookie is non-HttpOnly on purpose.** The banner needs to read it client-side to decide whether to render. It carries no PII — just an opaque ID. HttpOnly cookies for auth tokens are still HttpOnly.
5. **Unsubscribe is single-use.** Replaying a consumed token returns `alreadyDone: true` with HTTP 200; expired/invalid token returns 400/404. We never expose whether an unknown token *could have been* valid.
6. **No auto-accept anywhere.** Banner has three explicit choices. SMS is never auto-on, even from "Accept all" — it has its own toggle in `/account/preferences`.

## Endpoint inventory

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/privacy/consent` | optional (JWT or anon cookie) | mints anonId on first read |
| POST | `/privacy/consent` | optional | captures full record |
| PATCH | `/privacy/preferences` | bearer | partial update from preferences page |
| GET | `/privacy/unsubscribe/lookup` | none | shows email + category before confirm |
| POST | `/privacy/unsubscribe` | none, rate-limited 20/3600s ip | consumes token |
| GET | `/admin/privacy/consent/metrics` | bearer + ADMIN | opt-in counts by region |

(All existing `/privacy/data-export*` and `/privacy/delete*` endpoints from Phase 26 keep working — they were the only existing routes on this controller; everything else is new.)

## Schema additions

- `ConsentRecord` (one per identity, with both `userId @unique` and `anonId @unique`, region, policyVersion, category booleans, source)
- `ConsentEvent` (append-only history)
- `UnsubscribeToken` (one-shot per send)
- Enums `ConsentCategory`, `ConsentSource`, `ConsentRegion`
- `User.consentRecord` (back-relation) + `User.unsubscribeTokens`

No migrations required for tables we're not touching.

## Audit trail

Every capture writes:
1. A `ConsentEvent` row keyed by the canonical record (with before/after snapshots).
2. An `AuditLogEntry` via `AuditService.record` with action `consent.created` or `consent.updated`.

This double-write is deliberate — the ConsentEvent is the user-visible legal record; the audit log is the actor-visible operational record. They have different retention policies (consent forever, audit per data-retention rules).

## Manual test list

1. **First-visit banner.** Open buyer-web in incognito → banner appears bottom-right → "Accept all" → banner closes → reload page → banner does not reappear.
2. **EU detection.** Visit with `cf-ipcountry: DE` → banner shows the "with your permission" wording.
3. **Customize.** Click Customize → toggle Functional + Analytics, leave Marketing off → Save → record stored with the right booleans.
4. **Anonymous → login fold.** Accept banner anonymously → register a new account → check DB: anon record is gone, user record carries the same categories.
5. **Marketing email blocked.** Create user with `marketing: false`. Trigger `wishlist_price_drop` send → email service logs `email.dropped.consent`, no provider call.
6. **Marketing email allowed.** Same user with `marketing: true, marketingEmail: true`. Trigger send → email goes out with `Unsubscribe with one click: …` footer.
7. **Unsubscribe link.** Click the footer link → /unsubscribe page loads → confirm → DB flip: `marketingEmail: false`. Retry the same link → "already done".
8. **Transactional bypass.** Order paid → `order_paid` email goes out regardless of marketing toggles.
9. **Preferences page.** Toggle "All marketing" off → wishlist email no longer sends. Toggle back on → sends again. Toggle SMS individually → only SMS column changes.
10. **Admin metrics.** Visit `/privacy` on admin-web → see opt-in counts by region with percentages, and the recent-opt-outs note.
11. **Policy bump.** Set `CONSENT_POLICY_VERSION=2026-06-01` → next page load shows the banner even for users who had previously accepted (because their stored policyVersion is stale).
12. **Rate-limited unsubscribe.** Hit `/privacy/unsubscribe` 21 times from one IP within an hour → 429.

## Decisions worth highlighting

- **Hand-rolled cookie banner, no third-party CMP.** We considered OneTrust/Cookiebot. They're powerful but expensive and add a third-party script before consent — which is exactly what GDPR doesn't allow. A self-hosted banner with a static category map fits a certified-retail brand better.
- **Anon cookie is `httpOnly: false`** so the banner can short-circuit re-prompting without a server round-trip. The cookie carries no PII; it's just a key into our table.
- **No second-confirm modal on the banner.** Friction kills consent rates and the user research is clear that one-click decisions are honored more often. Per-category control lives behind "Customize" without a modal jump.
- **Marketing SMS is never auto-on.** "Accept all" enables email and push but leaves SMS off. CASL/TCPA/regulatory carrier rules treat SMS as a stricter consent threshold; making the user click into preferences once to flip it is the right safety default.
- **Unsubscribe link mints a *per-send* token.** Long-lived shared tokens would be simpler but they leak (a forwarded email becomes a permanent unsubscribe portal). One-shot tokens scoped to a single send + 90-day TTL is the right trade-off.
- **Region is captured once.** A user who consents in Berlin and later loads the site from NYC keeps their EU-strict consent. Re-bucketing every request would silently weaken protection without explicit user action.
- **`canSendMarketingEmail` is a single point of truth.** The email service and the (future) push service both call it. There's no parallel "is opted in?" function anywhere else — adding one would invite drift.

## Limitations / follow-ons

- **No geo-IP library.** We rely on CDN-supplied country headers; without them we fall back to Accept-Language. A MaxMind / IP2Location integration would tighten region detection but isn't required for a launch — the banner asks anyway.
- **No vendor / cookie-scanner integration.** OneTrust/Cookiebot style automatic discovery is out of scope.
- **Push consent isn't yet enforced at the push service.** Phase 27's notification feed is in-app and unaffected; PushDevice/Expo-side sends do not yet consult `marketingPush`. Tracked.
- **SMS provider isn't shipped.** When we add SMS marketing, it will plug into the same `canSendMarketing*` gate; today the toggle is reserved and the column stores intent.
- **Per-send open/click tracking is not added.** We honor unsubscribes but don't yet aggregate campaign performance.
- **Stale-consent re-prompt** ("ask again every 13 months") is not implemented; bumping `CONSENT_POLICY_VERSION` is the manual lever.
- **No admin override UI** beyond the metrics view. `ADMIN_OVERRIDE` source is a reserved value for a future "force-opt-out" surface (e.g. legal request).
- **Mobile app** doesn't render a banner. RN integration is part of the mobile parity phase. Today the mobile app sees marketing emails only if the user accepted on the web first.
