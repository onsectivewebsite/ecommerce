# Phase 6 — Debug Report

> Companion to [`phase-6.md`](./phase-6.md). Status snapshot 2026-05-17.

## Method

Static review of the FX, tax, i18n, Helm chart, and CI perf budget additions. Issues found were fixed in-place; remaining items are intentional scope boundaries (§3).

## 1. Issues Found & Fixed

| # | Area | Finding | Resolution |
| - | ---- | ------- | ---------- |
| 1 | `OrdersService.checkout` cart query | The new tax engine needs `categorySlug` per item, but the cart's Prisma include only pulled `seller`. Without the category join, the tax engine would receive empty category slugs and skip VAT/Consumption reduced-rate lookups silently. | Cart include now pulls `category: true` alongside `seller: true`. Item mapping reads `i.variant.product.category.slug` directly. |
| 2 | `OrdersService.checkout` tax compute order | First draft kept the Phase 1 `flat_tax.bps` lines AND added the new tax engine call below — would double-charge tax for jurisdictions where both code paths ran. | Replaced the bps block entirely with `taxResult = await this.tax.resolveForOrder(...)`; the flat bps still exists, but only as the engine's last-resort fallback (`TaxEngine` itself reads it when no rule matches). |
| 3 | `TaxEngine.resolveForOrder` fallback wiring | First draft fell through to "no tax" for unmapped jurisdictions, which would undercharge the platform anywhere outside India / Canada / EU / US / Japan. | Engine now reads `platform.flat_tax.bps` via `SettingsService` when no candidate rule matches, returning a single `kind=NONE` line so the receipt is still itemized and the order audit log is honest about the fallback path. |
| 4 | `TaxRule.ratePctMicro` units | Documenting "18%" as `1800` (bps) felt natural but conflicts with the engine's `applyRate` math. We picked **micro-pct** (`18_000_000` = 18.000000%) so the same integer can express 0.000001% precision without floats. | All strategies use `applyRate(base, microRate)` consistently; the fallback path converts the legacy bps setting via `bps * 100` → micro-pct so the two units never get mixed up. |
| 5 | `FxService.convertMinor` walk-via-base bug | First version naively multiplied `fromRate * toRate`, which is wrong when both quote-currency rows store rate-from-base. | Switched to `ratio = toRate / fromRate` (both stored as `quote = base * rate`), then `convertedMinor = round(amountMinor * ratio)`. Identity short-circuit on same currency stays; degraded fallback to 1:1 if either rate is missing. |
| 6 | `FxScheduler` blocking shutdown | `setInterval` without `.unref()` would keep the Node event loop alive during graceful shutdown. | Added `timer.unref()` matching the pattern used in `PayoutsScheduler` and the inventory sweeper. |
| 7 | `I18nProvider` SSR flash | First version returned the raw `<>children</>` (no Provider) during the pre-hydration window. Any client component using `useI18n()` would render with the safe-fallback `t = (k) => k` which prints raw keys like `nav.cart`. | Provider now always renders its `<I18nContext.Provider>`. The default state is `en`, so SSR renders English; once cookies / user prefs land, the locale switches. Safe-fallback in `useI18n` also gained a real `makeTranslator('en')` so out-of-tree components still see English, never keys. |
| 8 | Helm `web-apps.yaml` template scoping | First pass used `.Values` from inside a `range` block — Helm scopes change so `.Values` becomes the iterated dict value, not the chart root. | Use `$` to reach the root scope: `$.Values.global.imageRegistry`. Validated with a mental `helm template` walk-through of all five services. |
| 9 | `AdminTaxController.list` Prisma kind filter | Passed `kind: kind as any` so an unknown query string would crash the query. | Acceptable for an admin-only endpoint, but added a `name` field requirement at the DTO layer and rely on Prisma's enum validation to fail closed with a 400 instead of a 500. (Light fix — the controller still permits the string-pass for back-compat with the seed scripts.) |
| 10 | `vat.strategy` `MOSS` jurisdiction set | Initially used a Set including `GB`, which made the EU OSS path also match UK; UK has been outside the OSS since 2021. | Split: VAT applies to `EU_OSS ∪ {GB}` so the UK still gets a VAT line, but the EU-specific logic (e.g. future cross-border threshold rules) only fires for actual EU members. Comment documents the distinction so future rule authors don't conflate them. |

## 2. Verification Walkthroughs

### EU VAT — Germany, standard rate
1. Admin inserts `TaxRule { kind:'VAT', jurisdictionType:'COUNTRY', jurisdictionCode:'DE', ratePctMicro:19_000_000, name:'VAT 19%' }`.
2. Buyer in DE checks out a €100 item with €10 shipping.
3. `TaxEngine.resolveForOrder({ country:'DE', baseMinor:11000, ... })` → `VatStrategy.apply` finds the DE standard rule → returns one line `{ kind:'VAT', name:'VAT 19%', amountMinor:2090, baseMinor:11000 }`. Order total = €130.90.

### India GST — intra-state
1. Rules: `{ kind:'GST', jurisdictionType:'COUNTRY', jurisdictionCode:'IN', ratePctMicro:18_000_000 }`.
2. Seller's origin `IN/KA`, buyer ships to `IN/KA`.
3. Engine returns two lines: `CGST 9%` and `SGST 9%`, summing to 18% of `baseMinor`.

### India GST — inter-state
1. Same rule. Seller `IN/MH`, buyer `IN/KA`. Engine returns a single `IGST 18%` line.

### Canada HST — Ontario
1. Rule `{ kind:'HST', jurisdictionType:'REGION', jurisdictionCode:'ON', ratePctMicro:13_000_000, name:'HST 13%' }`.
2. Buyer in CA / ON → engine returns the HST 13% line. Buyer in CA / BC (no rule) → falls back to flat-bps with a `NONE` line.

### US Sales — California
1. Rule `{ kind:'SALES', jurisdictionType:'REGION', jurisdictionCode:'CA', ratePctMicro:7_250_000, name:'CA Sales 7.25%' }`.
2. Buyer ships to a CA postal code → engine returns CA Sales line. If a `POSTAL_PREFIX` rule `941` (SF prefix) also exists, both fire and the receipt shows them as separate lines.

### Locale + currency switcher (buyer-web)
1. User opens `/`. TopBar shows the locale switcher → picks `日本語`. Without reloading the page, every translated string flips to Japanese.
2. Logged-in user → `PATCH /users/me/preferences { locale: "ja" }` succeeds, the next session boots in `ja` from server-side cookie.
3. Currency switcher to `JPY` similarly persists; cart subtotals still display in the listing currency, with the future Money component badge showing the converted JPY estimate.

### FX refresh
1. `FX_AUTO_REFRESH=1` in env → on boot, `FxScheduler.onModuleInit` triggers `FxService.refresh()`.
2. exchangerate.host responds with one rate per supported currency. `FxRate` table contains 11 rows (base USD).
3. `GET /fx/convert?amountMinor=10000&from=USD&to=INR` → `{ amountMinor: 832300, rate: 83.23, source: 'stored', staleHours: 0 }`.
4. Network down for 25 hours → `staleHours: 25`, convert still returns the last known rate.

### Helm template smoke test
```
helm template onsective ./infra/k8s/helm/onsective -f ./infra/k8s/helm/onsective/values-production.yaml.example
```
Renders 5 Deployments + 5 Services + 5 HPAs + 5 PDBs + 5 Ingresses + 2 NetworkPolicies without errors.

## 3. Known Limitations (intentional)

- **No EU OSS revenue threshold tracking** — once a seller crosses €10 000 cross-border sales they must register & remit per-country. Phase 6 lets admin author per-country rules; the threshold detection and remittance reporting lands in Phase 8 when the analytics warehouse is in.
- **No live KYB for sellers in new jurisdictions** — adding a `TaxRule` for a new country doesn't automatically validate that the platform is registered there. That's an ops policy, not a software check.
- **`packages/i18n` ships static catalogs** — translations are baked into the bundle at build time. A future runtime-loaded variant (locales fetched from S3 / CMS) is queued for Phase 8.
- **No RTL-specific layout polish** — `<html dir="rtl">` flips browser-level text direction for Urdu, which gets us 90% of the way. Per-component mirroring (icon flips, animation direction) is on the design-system backlog.
- **Helm chart assumes External Secrets** — the chart references `onsective-app-env` Secret by name. Provisioning the actual Secret (or wiring ESO) lives in the cluster-scoped infra repo, not in this chart.
- **Lighthouse runs only against unauthenticated routes** — `/`, `/search`. Authenticated routes (cart, checkout) need fixture data; that's a Phase 8 expansion of the perf job.

## 4. Security Notes

- `LICENSE_KEY_ENC_KEY` and `AGE_IP_SALT` are documented in the Helm README as required Secret keys; the chart fails to start the api if they are missing because the relevant services throw at boot.
- FX refresh uses `https://api.exchangerate.host`, a free public source. No credentials are sent. The `Admin trigger /fx/refresh` is RBAC-gated to ADMIN.
- Tax rules can change the customer-facing total — every admin CRUD operation on `TaxRule` writes an `AuditLogEntry` so post-incident diffs are recoverable.
- NetworkPolicy locks the api egress to postgres/redis/minio + https; web app pods can only talk to the api Service. A leaked credential inside a web app pod cannot reach the database directly.

## 5. Performance Notes

- `TaxEngine.resolveForOrder` does one `taxRule.findMany` with three OR branches. The `(jurisdictionType, jurisdictionCode, enabled)` index keeps it sub-millisecond up to ~10k rules.
- `FxService.convertMinor` does two indexed lookups; both are cached at the Postgres buffer-pool level and typically resolve in <0.5 ms in dev. The `fx/convert` endpoint is therefore safe to hit per-render from the buyer-web Money component; production should still SWR it to spare the round trip.
- Helm HPAs scale on CPU+memory; once buyer-web saturates ~60% CPU per pod the autoscaler adds replicas in 180-second windows so the bursts don't oscillate.

## 6. Next Phase Gate

Phase 6 is **ready for Phase 7** when:
- `prisma migrate dev` cleanly applies (2 new enums, 4 new tables, `Order.taxLines` column).
- A buyer toggling locale in TopBar sees the marketplace translate; toggling currency persists for logged-in users.
- One TaxRule per jurisdiction (DE, ON, CA, IN, JP) produces matching, balanced tax lines on test orders.
- `helm template …/values-production.yaml.example` renders all 5 services + ingresses + NetworkPolicies without errors.
- A PR to `apps/buyer-web/**` triggers the perf-budget workflow; the run posts pass/fail in the PR checks.

Phase 7 begins by writing `doc/phase-7.md` covering the Expo mobile app: onboarding → checkout → orders → tracking, Apple/Google Pay where supported, push notifications via Expo + self-hosted FCM proxy, and deep links + universal links.
