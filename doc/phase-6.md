# Phase 6 — i18n & Scale Hardening

> Status: 🟡 in progress · Owner: platform · Window: 2026-05-17 → 2026-05-17

Phase 6 turns Onsective into a globally deployable marketplace. It ships full localization for the 9 launch languages, a refreshable FX rate store with currency conversion, a pluggable tax engine that covers GST / HST / VAT / Sales / Consumption tax models, a production Kubernetes Helm chart with HPA + PDB, and a CI gate that fails the build when buyer-web Lighthouse scores regress below the agreed budget.

## 1. Goals

1. **Locale catalog** (`packages/i18n`) covering `en`, `hi`, `fr`, `ja`, `zh`, `ur`, `bn`, `vi`, `ru`; extensible to more without recompiling apps.
2. **Buyer-web** picks the locale from URL prefix (`/en`, `/hi`, …) with middleware fallback to the `Accept-Language` header, persisted via `UserPreferences.locale` for logged-in buyers.
3. **Multi-currency display**: a `FxRate` table refreshed hourly from a free public API, with degraded-mode fallback to last-known rate or 1:1 identity. `Money` component renders in the buyer's preferred currency, with a tiny "converted from X" badge when it differs from the listing currency.
4. **Tax engine**: `TaxStrategy` interface; concrete strategies for India GST (intra/inter-state CGST+SGST / IGST split), Canada HST/GST+PST, EU VAT (cross-border B2C OSS rules at a basic level), US Sales Tax (origin-state simple), Japan Consumption Tax. Admin can configure per-jurisdiction `TaxRule` rows; `OrdersService.checkout` replaces the Phase 1 flat-bps with the resolved rate.
5. **Kubernetes Helm chart** under `infra/k8s/helm/onsective` deploying api + 4 web apps with HPA on CPU + memory, PodDisruptionBudget per service, ingress per public hostname, and a NetworkPolicy that scopes Postgres/Redis access to the api pod.
6. **Performance budgets** enforced by CI: Lighthouse run against buyer-web `/`, `/c/<cat>`, `/p/<slug>` with hard fails on FCP > 1.8 s, LCP > 2.5 s, total JS > 350 KB (compressed), CLS > 0.05.

## 2. Non-goals (intentional, deferred)

- **Live FX from paid providers** (OXR, Fixer). Phase 6 uses `exchangerate.host` (free, no key) with daily refresh; production swap to a paid provider is one config change.
- **Per-product translations** stored in DB. Phase 6 lets sellers write product copy in any language; we don't currently auto-translate or store per-locale variants. A `TranslationOverride` table is in the schema for Phase 7+ to use without another migration.
- **Tax registration / filing automation** — out of scope; the engine accrues correct tax per line but does not file returns or generate jurisdictional reports beyond the existing audit log.
- **Global CDN config** — the Helm chart sets up ingress + cert-manager hooks; CloudFront / Cloudflare wiring is environment-specific and lives in `infra/terraform/` (Phase 8).
- **Real load testing** — k6 scripts ship in Phase 8 alongside the DR runbook. Phase 6 perf budget is a per-PR regression gate, not a load test.

## 3. Data model additions

```
enum TaxKind { GST  HST  VAT  SALES  CONSUMPTION  NONE }
enum TaxJurisdictionType { COUNTRY  REGION  POSTAL_PREFIX }

model FxRate {
  id          String   @id
  base        String   // ISO-4217 (e.g. USD)
  quote       String   // ISO-4217
  rate        Decimal  @db.Decimal(18, 8)   // quote = base * rate
  source      String   @default("exchangerate.host")
  fetchedAt   DateTime @default(now())

  @@unique([base, quote])
  @@index([fetchedAt])
}

model TaxRule {
  id                String              @id
  name              String
  kind              TaxKind
  jurisdictionType  TaxJurisdictionType
  jurisdictionCode  String              // ISO-2 / region code / postal prefix
  ratePctMicro      Int                 // 18.00% → 18_000_000 (6 decimals)
  includedInPrice   Boolean             @default(false)
  categorySlug      String?             // restrict to a category if set
  priority          Int                 @default(100)
  enabled           Boolean             @default(true)
  notes             String?
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  @@index([jurisdictionType, jurisdictionCode, enabled])
  @@index([kind])
}

model UserPreferences {
  userId    String   @id
  locale    String   @default("en")
  currency  String   @default("USD")
  updatedAt DateTime @updatedAt

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model TranslationOverride {
  id         String   @id
  entityType String   // "product" | "category"
  entityId   String
  locale     String
  field      String   // "title" | "description"
  value      String
  updatedAt  DateTime @updatedAt

  @@unique([entityType, entityId, locale, field])
  @@index([entityType, entityId])
}
```

## 4. Backend module layout

```
services/api/src/modules/fx/
  fx.module.ts
  fx.service.ts        # convertMinor(amount, from, to) + balance query
  fx.scheduler.ts      # setInterval daily refresh, gated by FX_AUTO_REFRESH=1
  fx.controller.ts     # GET /fx/rates (public), GET /fx/convert?from&to&amount

services/api/src/modules/tax/
  tax.module.ts
  tax.engine.ts        # resolveForOrder(items, shippingCountry, shippingRegion, postalCode)
  strategies/
    gst.strategy.ts
    hst.strategy.ts
    vat.strategy.ts
    sales.strategy.ts
    consumption.strategy.ts
  admin-tax.controller.ts  # /admin/tax/rules CRUD

services/api/src/modules/i18n/
  i18n.module.ts
  user-prefs.service.ts        # GET/PATCH /users/me/preferences
  user-prefs.controller.ts
  locale.constants.ts          # supported list, default per region
```

### Integration

- **OrdersService.checkout** now calls `TaxEngine.resolveForOrder(items, shippingAddress)` instead of reading `platform.flat_tax.bps`. The flat-bps remains as a global default when no `TaxRule` matches. The resolved tax breakdown (sum + per-component lines: CGST / SGST / VAT / etc.) is stored on the order via a `taxLines` JSON field for the receipt.
- **Cart subtotal** stays in the seller-listed currency; FX conversion only happens at display time.
- **Receipt + admin order detail** show the tax breakdown.

## 5. Frontend deliverables

### Buyer-web (`apps/buyer-web`)
- `next-intl` middleware: detect locale from cookie → URL prefix → `Accept-Language` → fallback `en`.
- All UI strings extracted to `packages/i18n/locales/<code>.json`. Server components use `getTranslator(locale)`; client components use `useTranslations(ns)`.
- `<LocaleSwitcher />` + `<CurrencySwitcher />` in TopBar. Logged-in: PATCH `UserPreferences`. Anonymous: write cookie (`onsective_locale`, `onsective_currency`).
- `<Money>` (in `@onsective/ui`) accepts an optional `displayCurrency`; if set + different from listing currency, it calls `FxApi.convert` (cached via SWR) and renders e.g. `₹1,499` with a `· $17.99 listing` subscript.

### Seller-web / Admin-web / Shipping-web
- Wired with next-intl too, but with English-only catalogs in this phase. Strings are extracted and ready for translators; the routing is a no-op pass-through for non-buyer apps.

### Admin-web addition
- `/tax-rules` page: CRUD `TaxRule`. Filter by kind / jurisdiction. Audit log entries created on every edit.

## 6. Helm chart layout

```
infra/k8s/helm/onsective/
  Chart.yaml
  values.yaml                          # defaults (image tags, replicas)
  values-production.yaml.example       # cluster-specific override sample
  templates/
    _helpers.tpl
    api-deployment.yaml
    api-service.yaml
    api-hpa.yaml
    api-pdb.yaml
    buyer-deployment.yaml + service + hpa + pdb
    seller-deployment.yaml + service
    admin-deployment.yaml + service
    shipping-deployment.yaml + service
    ingress.yaml                       # one Ingress per public hostname
    network-policy.yaml                # api → postgres/redis/minio only
    secret.envvars.yaml                # External Secrets Operator integration point
    configmap.app.yaml
```

Targets:
- **api**: 3 replicas baseline, HPA 3→10 on 70% CPU.
- **buyer-web**: 4 replicas baseline (highest traffic), HPA 4→20 on 60% CPU.
- **seller-web / admin-web / shipping-web**: 2 replicas baseline, HPA 2→6.
- **PDB**: `minAvailable: 1` for every service so node drains don't take the marketplace offline.
- **Probes**: `/health` for all backend services (already exposed); web apps probe `/` with a 5xx-fail status.

## 7. CI perf budget

```
.github/workflows/perf-budget.yml
.lighthouserc.cjs
```

Trigger: every PR touching `apps/buyer-web/**` or `packages/ui/**`. Spins up buyer-web against a built API in Docker Compose, runs Lighthouse 3× per URL, asserts:

| Metric | Budget |
| ------ | ------ |
| First Contentful Paint | ≤ 1800 ms |
| Largest Contentful Paint | ≤ 2500 ms |
| Total Blocking Time | ≤ 200 ms |
| Cumulative Layout Shift | ≤ 0.05 |
| Total JS transfer | ≤ 350 KB gzipped |
| Total image transfer | ≤ 600 KB |
| Performance score | ≥ 0.85 |

Fails the check on any breach; comments the diff on the PR.

## 8. Decisions log (Phase 6)

| ID | Decision | Rationale |
| -- | -------- | --------- |
| D-034 | URL-prefix locale routing | SEO-friendly and lets Cloudflare cache per-locale; cookie is the persistence hint, URL is the truth. |
| D-035 | FX rates persisted with `Decimal(18,8)` | Floats lose precision on JPY-like 0-decimal currencies after a couple of round-trips; Decimal avoids drift. |
| D-036 | TaxRule.ratePctMicro stored as integer (6 dec) | Same drift-avoidance reasoning as money minor units. `1800_0000` = 18.0000% with room for 0.000001% precision. |
| D-037 | Strategies own jurisdiction logic | A single switch-statement in TaxEngine becomes unmaintainable across 5+ jurisdictions. Strategy classes localize jurisdictional quirks (GST intra vs inter-state, VAT MOSS thresholds) without touching the engine. |
| D-038 | Tax fallback to flat-bps setting | When no rule matches the buyer's jurisdiction we keep collecting the platform's default `flat_tax.bps`, so we never accidentally undercharge. Admin gets a warning in the order audit log. |
| D-039 | Helm chart over raw manifests | Lets each environment (staging / production / EU / IN) override 4–6 values without forking YAML. Templating burden is worth it past 3 services. |
| D-040 | External Secrets Operator integration | Secrets stay in AWS Secrets Manager / Vault and sync into k8s; the chart references the secret name rather than embedding the secret. |
| D-041 | Lighthouse, not k6, in PR CI | Per-PR runs need to complete in under 3 minutes. k6 load tests are scheduled nightly in Phase 8 against a staging environment. |

## 9. Exit criteria

- A buyer can switch the buyer-web to `hi` and see translated strings on home, PDP, cart, checkout.
- A buyer in `INR` displayed currency sees the right converted prices; the FxRate table has at least one row per supported currency pair after the scheduler runs once.
- Checking out a $100 item shipping to Karnataka, India yields `IGST 18%` ($18) as a tax line (intra-state-seller would be CGST 9% + SGST 9%). Shipping to Ontario yields `HST 13%`. Shipping to California yields `Sales 7.25%`. Shipping to a non-rule country falls back to the flat `platform.flat_tax.bps`.
- `helm install onsective ./infra/k8s/helm/onsective -f values-production.yaml.example` renders without errors and produces all expected manifests.
- The perf-budget CI job runs against a PR and reports pass/fail with the table above.
- `doc/phase-6-debug.md` lists all issues found and fixed.
