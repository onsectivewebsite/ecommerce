# Phase 29 — Debug Pass

Companion to `phase-29.md`. Decisions made, seams to watch, what to
test before merging.

## 1. The invariants Phase 29 preserves

1. **Stripe is the source of truth for Connect status.** The
   Seller row mirrors fields but no non-sync code path writes
   them. The webhook (`account.updated`), the return-URL
   handler, and the on-demand sync action all flow through the
   same `SellerOnboardingService.sync` method.
2. **Payouts are gated on `payoutsEnabled`.** Both the daily
   payout-run path (which chooses METHOD per seller) and the
   `execute()` path (which fires the transfer) check
   `seller.payoutsEnabled` before reaching for Stripe. A seller
   stuck in PENDING/RESTRICTED/REJECTED gets MANUAL instead.
3. **DISABLED is sticky.** A sync run never overwrites
   `DISABLED` because admin intent overrides Stripe state.
4. **Onboarding URLs are single-use.** Every `/start` call mints
   a fresh AccountLink; we never cache the URL.
5. **Webhook re-delivery is a no-op.** `sync` is idempotent —
   reading the canonical state and rewriting the same mirror
   doesn't change anything.

## 2. Non-obvious decisions

### 2.1 Express not Standard
Express accounts let Stripe host onboarding/dashboard but keep
the marketplace experience under Onsective's brand. Standard
would require sellers to have/use their own Stripe account and
would expose the Stripe brand at signup. For a certified-retail
platform whose value is the verification layer, Express is the
right fit.

### 2.2 Requirements as JSON
`connectRequirementsDue` snapshots
`account.requirements.currently_due` as a JSON array. Stripe's
requirement strings change over time (e.g., new compliance
demands in new jurisdictions). Modeling each requirement as a
row would be premature normalization for a list we don't query
across.

### 2.3 RESTRICTED is its own status
Stripe's "restricted" doesn't fit `enabled` or `disabled`. The
account can charge but payouts are paused while requirements
get resolved. We need this bucket so payout routing gates
correctly and the UI can render "resolve requirements".

### 2.4 DISABLED is admin-only
Stripe never reports DISABLED. It's our local override for
"admin manually disabled this seller's payouts pending
investigation." Lives only on the Onsective side; sync won't
touch it, only `admin/connect/disable` sets it.

### 2.5 Webhook handler lives in payments, listener in payouts
The `account.updated` event is parsed in `StripePaymentProvider`
(co-located with all other Stripe webhook parsing). The
dispatcher emits a domain event
`seller.connect.account_updated`. A separate
`ConnectAccountListener` in the payouts module subscribes and
calls `SellerOnboardingService.syncByStripeAccountId`. Keeps
payments/loyalty/payouts module boundaries clean — payments
doesn't import payouts business logic.

### 2.6 Return URL hits the API, then redirects
Stripe sends sellers back to a URL after onboarding. We point
that URL at the API (`/seller/onboarding/payouts/return?
sellerId=...`), not the seller-web. The API runs sync first so
when the seller lands back on the seller-web page, the new
status is already mirrored.

### 2.7 Refresh URL doesn't sync
Stripe's "refresh" URL fires when an AccountLink expires
mid-flow. We don't sync here — the account hasn't progressed —
just bounce to the seller-web page where the user can
re-trigger `start`.

### 2.8 Payout gate respects MANUAL escape hatch
Existing PayoutsService already supports `method=MANUAL` for
dev/no-Stripe environments. We didn't change that — admin can
still issue a MANUAL payout via the existing path even if a
seller's Connect account is in a weird state. The gate only
blocks STRIPE_CONNECT.

### 2.9 Banner only shows when payouts are off AND not on the
onboarding page
The seller-web Shell renders a top banner pushing the user to
finish onboarding — but only when `payoutsEnabled=false` AND
the user isn't already on the page that resolves it. Avoids
"you are here" nag.

### 2.10 Admin oversight is API-only for now
The endpoints exist (`GET /admin/sellers/:id/connect`, force
sync, disable) and an `AdminSellerConnectApi` is wired into
admin-web. A dedicated admin UI for the column / detail page
was descoped to keep the phase tight — the data is available
to admin via the API and the existing audit log captures
disable actions. Building the UI is a one-page polish
follow-up.

## 3. Things to test end-to-end

Stripe CLI prerequisite (already running for other Stripe webhooks):
```
stripe listen --forward-to localhost:4000/payments/webhook/stripe
```

- Seller hits `/seller/onboarding/payouts` for the first time →
  status NOT_STARTED, "Set up payouts" CTA.
- Click CTA → POST `/seller/onboarding/payouts/start` returns a
  Stripe AccountLink URL → seller-web redirects.
- Complete Stripe's hosted flow in test mode → Stripe 302s back
  to `${API}/seller/onboarding/payouts/return?sellerId=...` →
  sync runs → seller-web page reloads → status ENABLED, badge
  green, "Open Stripe dashboard" CTA appears.
- `account.updated` webhook delivery → re-sync; local row
  matches Stripe's `payouts_enabled` field.
- Force a restricted state in Stripe test mode (e.g., trigger a
  missing-document requirement) → status flips to RESTRICTED,
  requirements list renders.
- Trigger a payout while seller is in RESTRICTED →
  `PayoutsService.run` writes `method=MANUAL` for the period
  rather than STRIPE_CONNECT.
- Resolve requirements → status flips back to ENABLED →
  subsequent payout runs route to STRIPE_CONNECT again.
- Admin `POST /admin/sellers/:id/connect/disable` → status flips
  to DISABLED; sync no-ops; payouts still MANUAL.
- Seller-web TopBar banner renders for any non-DISABLED seller
  whose `payoutsEnabled=false`; disappears on the onboarding
  page itself.
- Webhook re-delivery of `account.updated` → no duplicate state
  change.
- `doc/phase-29-debug.md` captures decisions + limitations.

## 4. Known limitations

- **No admin UI surface.** Endpoints + api-client are there, but
  no dedicated `/admin/sellers/[id]/connect` page yet. Polish
  follow-up.
- **No multi-currency payouts.** Connect accounts are created
  with the seller's `originCountry`; payouts settle in that
  account's default currency.
- **Express-only.** No Standard / Custom variants.
- **No 1099 / tax form UI.** Stripe surfaces these in their
  hosted dashboard (which we link to once ENABLED).
- **`requirementsDue` rendered as-is.** Strings like
  `individual.verification.document` aren't humanized; we just
  replace underscores. Acceptable for v1.
- **No webhook signing verification beyond the existing
  STRIPE_WEBHOOK_SECRET.** Same model as Phase 23.
- **Onboarding link expires in ~24h.** Stripe controls this
  TTL; our `refresh` URL handler 302s the seller back to our
  page so they can click "Continue onboarding" for a fresh
  link.
- **Country defaults to US.** A seller without `originCountry`
  set on their profile gets a US Express account. We could
  prompt for country during onboarding setup if a multi-region
  launch demands it.
- **Disabled state has no admin-side toggle in the UI yet.**
  The endpoint exists; the UI surface is the same polish
  follow-up.

## 5. Files added

- `services/api/src/modules/payouts/seller-onboarding.service.ts`
- `services/api/src/modules/payouts/seller-onboarding.controller.ts`
- `services/api/src/modules/payouts/connect-account.listener.ts`
- `packages/api-client/src/endpoints/seller-onboarding.ts`
- `apps/seller-web/src/app/seller/onboarding/payouts/page.tsx`

## 6. Files edited

- `services/api/prisma/schema.prisma` — added
  `ConnectAccountStatus` enum + five new fields on `Seller`
  (`connectAccountStatus`, `payoutsEnabled`,
  `connectOnboardedAt`, `connectLastSyncedAt`,
  `connectRequirementsDue`).
- `services/api/src/modules/payouts/stripe-connect.service.ts`
  — added `createAccountLink`, `createLoginLink`,
  `retrieveAccount` helpers.
- `services/api/src/modules/payouts/payouts.service.ts` —
  payout-method routing + execute() gated on
  `payoutsEnabled`.
- `services/api/src/modules/payouts/payouts.module.ts` —
  registered new service / controllers / listener.
- `services/api/src/modules/payments/stripe.provider.ts` —
  parse `account.updated` webhook into
  `connect_account_updated`.
- `services/api/src/modules/payments/gateway.ts` — added the
  new event type.
- `services/api/src/modules/payments/payments.service.ts` —
  webhook dispatcher emits
  `seller.connect.account_updated` domain event.
- `packages/api-client/src/index.ts` — re-export
  `seller-onboarding`.
- `apps/seller-web/src/lib/api.ts` — wired
  `SellerOnboardingApi` as `api.onboarding`.
- `apps/seller-web/src/components/Shell.tsx` — payouts-not-set-up
  banner.
- `apps/admin-web/src/lib/api.ts` — wired
  `AdminSellerConnectApi` (UI surface deferred).

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_29_connect_onboarding
pnpm -r typecheck
pnpm -r build
```

Required env (no new secrets — reuses STRIPE_SECRET_KEY +
STRIPE_WEBHOOK_SECRET from Phase 4/23):

```
API_PUBLIC_URL=https://api.onsective.com         # used to build return / refresh URLs
SELLER_WEB_URL=https://seller.onsective.com      # bounce target after onboarding
```

In dev, `API_PUBLIC_URL` defaults to `http://localhost:4000`
and `SELLER_WEB_URL` defaults to `http://localhost:3001`. The
migration adds one enum, five new columns on Seller, no
backfill — existing sellers default to NOT_STARTED with
`payoutsEnabled=false`, which is the correct initial state.
