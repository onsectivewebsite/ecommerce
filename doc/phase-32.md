# Phase 32 — Cookie Consent & Marketing Preference Center

> Closes the consent-management gap that GDPR, ePrivacy, CASL, and CAN-SPAM all require before a launch. Phase 26 covered the *right to access / delete* — this phase covers the *right to opt out before tracking and marketing happens*. Every marketing email gets a one-click unsubscribe; every EU/UK visitor gets a clear pre-tracking cookie choice; preferences are honored at send-time, not just at the UI.

## Goals

1. **Capture cookie consent** for analytics + marketing categories. EU/UK regions default to opt-in; rest-of-world defaults to opt-out (allowed) but the banner still asks. Decision recorded with timestamp, IP-region, and policy version.
2. **Granular marketing channel preferences.** Email-marketing, SMS-marketing, push-marketing, on-site personalization — each toggle independent. Transactional sends (order receipts, security, shipping) never blocked.
3. **One-click unsubscribe link** on every marketing email — opaque signed token, single-purpose, no login required. Honors immediately and records an audit event.
4. **Send-time enforcement.** The email service blocks marketing kinds when the recipient has marketing email = false. No template that's tagged marketing can leak past this gate.
5. **Idempotent banner.** Once a logged-in user has captured consent, the banner doesn't re-prompt across devices. For anonymous visitors we cookie the choice.
6. **Admin visibility.** An admin can see consent coverage and recent opt-outs.

## Non-Goals

- Region detection from geo-IP (we approximate via Accept-Language + Cloudflare's `cf-ipcountry` header if present; full MaxMind / IP2Location integration is a follow-on).
- Cookie scanning / automatic vendor-list discovery (we maintain a static category map).
- DPIA generation, ROPA, or other GDPR-Article-30 record-keeping artifacts (out of scope).
- Server-side consent enforcement for client-side analytics scripts beyond a gating boolean exposed to the buyer-web — actually wiring `gtag.js` / Segment / etc. is out of scope because we don't ship those today.

## Schema

```prisma
enum ConsentCategory {
  ESSENTIAL          // always on; recorded for completeness
  FUNCTIONAL         // remember-me, language, cart persistence
  ANALYTICS          // product analytics, A/B tests
  MARKETING          // ad targeting, marketing emails, SMS, push
}

enum ConsentSource {
  BANNER             // cookie banner (anonymous + logged-in)
  PREFERENCES_PAGE   // /account/preferences toggle
  UNSUBSCRIBE_LINK   // email footer one-click
  ADMIN_OVERRIDE     // admin manually flipped (rare; audited)
  IMPORT             // bulk import from a prior system (none today)
}

enum ConsentRegion {
  EU                 // GDPR + ePrivacy — opt-in default
  UK                 // UK GDPR — opt-in default
  CA                 // California — opt-out with "Do Not Sell" rights
  REST               // everywhere else — defaults to "allowed unless rejected"
}

/**
 * The current consent state for a user OR an anonymous session.
 * Exactly one of (userId, anonId) is set. When a logged-in user resolves
 * an anon session (login from a browser that already accepted), we copy
 * the anon record onto the user and delete the anon row.
 */
model ConsentRecord {
  id              String         @id
  userId          String?        @unique
  anonId          String?        @unique
  region          ConsentRegion
  policyVersion   String          // bumped when the cookie policy / privacy policy text changes
  essential       Boolean         @default(true)        // always true; here for symmetry
  functional      Boolean         @default(false)
  analytics       Boolean         @default(false)
  marketing       Boolean         @default(false)
  marketingEmail  Boolean         @default(false)       // sub-toggle of marketing for transactional vs marketing email
  marketingSms    Boolean         @default(false)
  marketingPush   Boolean         @default(false)
  source          ConsentSource
  ipHash          String?
  userAgent       String?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  user            User?           @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model ConsentEvent {
  id            String          @id
  consentId     String
  userId        String?
  anonId        String?
  source        ConsentSource
  region        ConsentRegion
  policyVersion String
  before        Json
  after         Json
  ipHash        String?
  userAgent     String?
  createdAt     DateTime        @default(now())
  @@index([consentId, createdAt])
  @@index([userId, createdAt])
}

/**
 * Opaque signed tokens used by the email unsubscribe link. We don't want to
 * reuse JWTs (different lifetime, different audience) — a separate table keeps
 * the surface small and lets us revoke individual tokens if needed.
 */
model UnsubscribeToken {
  id          String   @id
  userId      String
  tokenHash   String   @unique
  category    String                          // e.g. "marketingEmail" — column on ConsentRecord to flip to false
  expiresAt   DateTime
  consumedAt  DateTime?
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}
```

## Region detection

Order of preference at consent-capture time:
1. `cf-ipcountry` header (Cloudflare or similar — most reliable when behind a CDN).
2. `x-vercel-ip-country` (Vercel hosting).
3. Accept-Language first tag (`en-GB` → UK).
4. Fall back to `REST`.

A static map (`EU_COUNTRIES`, `UK`, `CA_REGIONS = ['US-CA']`) does the bucketing. Stored on the record once at first capture; we don't re-bucket as the user travels — that would be more surprising than helpful.

## Endpoints

```
POST /privacy/consent                          # capture/replace consent (auth optional; anonId in cookie)
GET  /privacy/consent                          # current state for logged-in user OR anonId cookie
PATCH /privacy/preferences                     # logged-in only; partial update to marketing toggles
POST /privacy/unsubscribe                      # body { token, category? }; no auth needed
GET  /privacy/unsubscribe/lookup?token=...     # GET-friendly view: returns category + user-email for the unsub landing page
GET  /admin/privacy/consent/metrics            # admin: opt-in rates by region + recent opt-out trend
```

## Cookie banner

- Buyer-web client component, sticky bottom-right on first paint when no `ons_consent_v1` cookie is present AND no logged-in `ConsentRecord` exists.
- Three buttons: "Accept all", "Reject non-essential", "Customize". Customize expands per-category toggles inline (no modal — friction kills consent rates).
- On accept: POST `/privacy/consent` with the chosen state + source `BANNER`. Server returns updated record; client sets `ons_consent_v1` cookie (180-day, secure, lax) with category booleans + policyVersion, so we don't re-prompt on every page.
- Logged-in: server-side record is canonical; the cookie is just a hint.
- Anonymous: server creates a `ConsentRecord` keyed by `anonId` (sha256 of the user-agent + a random nonce stored in the cookie). On login, we resolve: if the user has no record, copy the anon row; if they do, the user row wins and the anon row is deleted.

## Email gating

In `services/api/src/modules/email/email.service.ts` (or whichever is the central send fn):
- Templates declare a `kind: 'transactional' | 'marketing'` (already partly present).
- For `marketing`: before sending, look up `ConsentRecord` for the recipient userId. If missing or `marketingEmail === false`, drop the send and emit an `email.dropped.consent` log event for observability. Never throw — caller doesn't care.
- Auto-append a footer (separate `marketingFooter()` helper) containing: `Unsubscribe from these emails: <signed link>`. The link uses an `UnsubscribeToken` minted per send (one-shot, 90-day expiry, category=`marketingEmail`).
- Transactional sends bypass both checks; an order receipt or password reset can never be blocked by marketing consent.

## Unsubscribe landing page

`/unsubscribe?token=...` on buyer-web:
1. GET `/privacy/unsubscribe/lookup?token=...` to render: "You are about to unsubscribe `user@example.com` from marketing emails."
2. Confirm button → POST `/privacy/unsubscribe { token }`.
3. On success: "You're unsubscribed. You can manage all preferences here." Link to `/account/preferences` (also works without re-login since we exchanged the token for the action).
4. Token errors (expired, consumed, invalid) → clear message + link to manual preferences page.

## /account/preferences expansion

Add a "Marketing" section with three toggles (email, SMS, push) and a "Personalized recommendations" toggle (binds to `analytics`). Existing locale/currency rows stay above.

## Admin

`/admin/privacy/consent/metrics` returns:
```json
{
  "totalUsers": 12340,
  "byRegion": { "EU": {...}, "UK": {...}, "CA": {...}, "REST": {...} },
  "byCategory": { "functional": { "optedIn": 8124 }, "analytics": {...}, "marketing": {...} },
  "recentOptOuts": [ /* last 50 source=UNSUBSCRIBE_LINK events */ ]
}
```

Visible at admin-web `/privacy` page (the existing page expands with a "Consent" tab).

## Out-of-scope follow-ons

- Geo-IP lookup library (MaxMind, IP2Location) — current detection via CDN headers + Accept-Language is good enough for v1.
- Vendor / cookie scanner integration (OneTrust, Cookiebot).
- Per-purpose granular consent beyond the four current categories.
- DPIA / ROPA / record-of-processing-activities templates.
- Automated stale-consent re-prompt (e.g. ask again every 13 months).
