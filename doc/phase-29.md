# Phase 29 — Stripe Connect Seller Onboarding

Date opened: 2026-05-19
Predecessor: Phase 28 (SEO, Structured Data & Sitemaps)

## 1. Why this phase

Phase 4 wired the transfer mechanism — `StripeConnectService.transfer`
moves money from the platform balance to a connected account when
the payouts pipeline fires. Phase 23 added saved cards for buyers.
But the seller side has been quietly half-finished since Phase 4:

- `Seller.stripeConnectId` exists but has no creation path other
  than a hidden admin action.
- There is no seller-facing onboarding UI. A new seller can sign
  up, list products, and accrue payable balance, but cannot
  collect.
- The platform doesn't check whether a Connect account is
  actually in good standing before attempting a transfer; the
  Stripe API call just fails at run time.

Phase 29 closes that loop with five concrete deliverables:

1. **Schema for Connect state mirroring.** `connectAccountStatus`
   enum on `Seller` plus `payoutsEnabled` boolean and a
   requirements snapshot.
2. **Onboarding flow.** Seller hits "Set up payouts" → server
   creates Express account if missing → returns Stripe-hosted
   AccountLink → seller completes onboarding on Stripe → return
   URL refreshes status.
3. **Webhook-driven sync.** `account.updated` updates the local
   mirror so charges_enabled / payouts_enabled / requirements
   stay current without polling.
4. **Payout gate.** `PayoutsService` refuses STRIPE_CONNECT
   payouts unless `payoutsEnabled=true`.
5. **Seller + admin UI.** Seller-web `/seller/onboarding/payouts`
   shows status, requirements, action buttons. Admin gets a
   read-only Connect column on the sellers list.

## 2. Scope (in)

### 2.1 Schema additions on Seller
```
connectAccountStatus  ConnectAccountStatus @default(NOT_STARTED)
payoutsEnabled        Boolean              @default(false)
connectOnboardedAt    DateTime?
connectLastSyncedAt   DateTime?
connectRequirementsDue Json?    // cached account.requirements.currently_due
```

```
enum ConnectAccountStatus {
  NOT_STARTED   // no stripeConnectId
  PENDING       // account exists, requirements outstanding
  RESTRICTED    // can charge but payouts paused (Stripe-side requirements)
  ENABLED       // charges + payouts both enabled
  REJECTED      // Stripe rejected the account
  DISABLED      // admin-disabled locally; payouts off regardless of Stripe state
}
```

### 2.2 StripeConnectService extensions
- `createAccountLink({ accountId, returnUrl, refreshUrl })` →
  returns Stripe AccountLink URL.
- `retrieveAccount(accountId)` → returns canonical state
  (`status` derived from `charges_enabled` + `payouts_enabled`
  + `details_submitted`).
- `createLoginLink(accountId)` → returns dashboard URL (used
  when ENABLED so seller can view their balance / payout
  schedule on Stripe directly).

### 2.3 SellerService.requestPayoutSetup(sellerId, actor)
1. Resolve seller; refuse if status is not APPROVED.
2. If `stripeConnectId` missing, call
   `StripeConnectService.createConnectAccount(seller.contactEmail, seller.originCountry)`.
   Store the resulting `acct_xxx` on Seller.
3. Build AccountLink with
   - `return_url`  = `${API_PUBLIC_URL}/seller/onboarding/payouts/return?sellerId=<id>`
   - `refresh_url` = `${API_PUBLIC_URL}/seller/onboarding/payouts/refresh?sellerId=<id>`
4. Return `{ url }` for the seller-web to redirect to.
5. Audit `seller.connect.start`.

### 2.4 SellerService.syncConnectStatus(sellerId)
- Calls `retrieveAccount` and derives the canonical status:
  - no `details_submitted` → PENDING
  - `payouts_enabled=true && charges_enabled=true` → ENABLED
    (set `connectOnboardedAt` if first time)
  - `disabled_reason` present → RESTRICTED unless `payouts_enabled=false && charges_enabled=false` → REJECTED
  - admin-disabled locally (DISABLED) → unchanged
- Writes `connectAccountStatus`, `payoutsEnabled`,
  `connectRequirementsDue`, `connectLastSyncedAt`.

### 2.5 Webhook account.updated
Stripe webhook handler resolves `Seller.stripeConnectId =
event.account` and calls `syncConnectStatus`. Idempotent — a
re-delivery just re-syncs the same state.

### 2.6 Controller endpoints
- `POST /seller/onboarding/payouts/start` (auth, role=SELLER)
  → `{ url }`. Returns a fresh AccountLink even if one was
  already issued (Stripe AccountLinks are single-use).
- `GET /seller/onboarding/payouts/return?sellerId=...` →
  syncConnectStatus, then 302 to
  `${BUYER_WEB_URL/* seller-web */}/seller/onboarding/payouts?completed=1`.
- `GET /seller/onboarding/payouts/refresh?sellerId=...` →
  same redirect, no sync (Stripe sends this when the AccountLink
  expires mid-onboarding).
- `POST /seller/onboarding/payouts/login-link` → returns
  Stripe dashboard URL (refused if not ENABLED).
- `GET /seller/onboarding/payouts/status` → current state.
- `POST /admin/sellers/:id/connect/sync` (auth, role=ADMIN) →
  force-sync.

### 2.7 PayoutsService gate
Existing payout path branches on
`seller.stripeConnectId && stripe.isLive()` to choose
STRIPE_CONNECT. We add an additional check: refuse STRIPE_CONNECT
unless `seller.payoutsEnabled=true`. If a seller's payouts are
disabled, the payout row remains in PENDING with `method=MANUAL`
+ a note explaining why; admin can intervene.

### 2.8 Seller-web UI
- `/seller/onboarding/payouts` page:
  - Status badge with copy explaining the state:
    - NOT_STARTED — "Set up payouts to start receiving money."
    - PENDING — "Finish onboarding to enable payouts."
    - RESTRICTED — "Action needed: Stripe is asking for more info."
    - ENABLED — "Payouts are active."
    - REJECTED — "Stripe rejected this account. Contact support."
    - DISABLED — "Payouts disabled by Onsective. Contact support."
  - When PENDING/RESTRICTED, render the
    `connectRequirementsDue` list.
  - "Set up / continue onboarding" button → POST start →
    `window.location.href`.
  - "Open Stripe dashboard" button (ENABLED only) → POST
    login-link → window.open.
  - "Sync status" button → POST sync (admin-only on the
    seller side? — keep public-to-seller; cheap call).
- TopBar persistent banner in seller-web when
  `payoutsEnabled=false`: "Your payouts aren't set up yet."

### 2.9 Admin UI
- `/admin/sellers` gets a Connect-status column.
- `/admin/sellers/[id]` detail page shows full Connect state +
  "Force sync" button.

## 3. Scope (out)

- **Custom Connect accounts** (full KYC inside our app). We use
  Express because Stripe hosts the onboarding UI — that's the
  fastest path to a working payout flow.
- **Multi-currency payouts.** Sellers receive in their account
  currency, which is fine for v1.
- **1099 / tax form generation.** Stripe handles that for
  Express accounts.
- **Per-product fee splits / application fees.** Phase 4's
  commission model stays.
- **Connect Standard accounts.** Express only.
- **Marketplace-wide platform fees on Connect.** The platform
  already retains commission from the Phase 4 flow.

## 4. Architectural decisions made up front

### 4.1 Express, not Standard
Standard accounts let Stripe customers manage their own brand
on the dashboard but require they have a Stripe account. Express
hides Stripe behind Onsective's brand and lets us push them
through onboarding without leaving the impression that "Stripe
is the marketplace". For a certified-retail platform whose value
is the verification layer, Express is the right shape.

### 4.2 Local mirror, not live polling
We mirror the canonical state on the Seller row and refresh via:
- the `account.updated` webhook (real-time),
- the return URL after onboarding completes,
- an explicit `sync` action from admin or seller.

This avoids the latency of a Stripe round-trip on every read
(payout pipeline, admin list view, etc.).

### 4.3 RESTRICTED is a real status
Stripe's "restricted" doesn't map cleanly to enabled/disabled —
the account can charge but payouts are paused while requirements
get resolved. We need our own bucket for that so the payout
pipeline can gate correctly and the UI can render the
"resolve requirements" prompt.

### 4.4 DISABLED is an admin-only state
Stripe never reports DISABLED. It's our local override for
"admin manually disabled this seller's payouts pending
investigation." Syncing won't overwrite it; only an admin
unlock can.

### 4.5 Requirements as JSON
`connectRequirementsDue` snapshots
`account.requirements.currently_due` as JSON. Modeling each
requirement as a row would be premature normalization — Stripe's
requirement strings change over time and we don't need to query
across them.

### 4.6 Onboarding URL is single-use
Stripe AccountLinks are single-use. The seller-web always calls
`start` fresh, even if they bounced back. The endpoint creates
the link on demand and doesn't cache it.

### 4.7 Payout gate honors the MANUAL escape hatch
Existing PayoutsService already supports `method=MANUAL` for
sellers without Connect or in dev. We don't change that —
admin can still issue a MANUAL payout via the existing path
even if Stripe is unavailable. The gate only blocks STRIPE_CONNECT.

### 4.8 Webhook resolution by stripeConnectId, not metadata
Stripe `account.updated` events carry `event.account` (the
account id). We look up by `stripeConnectId` directly rather
than metadata, which is more reliable.

## 5. Acceptance criteria

- New seller hits POST `/seller/onboarding/payouts/start` →
  Stripe Express account created (`acct_xxx` saved on Seller),
  AccountLink URL returned. Seller redirects to Stripe, completes
  the hosted flow.
- Stripe completes onboarding and 302s the seller back to
  `/seller/onboarding/payouts/return` → status syncs to ENABLED
  (in test mode), seller-web shows the green badge.
- `account.updated` webhook fires → local Seller row stays in
  sync without polling.
- Seller-web `/seller/onboarding/payouts` renders the four
  state-distinct UIs (NOT_STARTED, PENDING, RESTRICTED,
  ENABLED). RESTRICTED shows the requirements.currently_due
  list.
- Seller tries a STRIPE_CONNECT payout while
  `payoutsEnabled=false` → payout falls back to MANUAL with a
  note "payouts not enabled on Connect account".
- Admin `/admin/sellers` shows the Connect-status column;
  detail page shows requirements + "Force sync" button.
- Seller-web TopBar banner renders when payouts not enabled.
- `doc/phase-29-debug.md` captures decisions + limitations.
