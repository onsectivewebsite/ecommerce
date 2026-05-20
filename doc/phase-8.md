# Phase 8 — Intelligence & Polish

> Status: 🟡 in progress · Owner: platform · Window: 2026-05-17 → 2026-05-17

Phase 8 is the launch-readiness phase. It adds real relevance to product search via an Elasticsearch indexer + tuned query DSL, ships product recommendations (frequently bought together, similar PDPs, and a tiny user→user collaborative score), exposes a GrowthBook-compatible A/B framework so the team can run experiments without code deploys, runs the WCAG 2.1 AA audit and fixes the obvious gaps in the shared design system, and lands the operational artifacts the launch needs — a k6 load-test rig and a disaster-recovery runbook.

## 1. Goals

1. **Elasticsearch search** with an indexer that mirrors `Product` (+ category, seller, attributes) into an `onsective-products` index, a typo-tolerant query DSL that prioritizes title > attributes > description, and per-locale analyzers for the launch languages. The Postgres `ilike` path from Phase 1 stays as a degraded-mode fallback when `ELASTICSEARCH_URL` is not set.
2. **Recommendations**: three endpoints, all backed by a `ProductCoView` table populated on `order.paid` plus a lightweight similarity score for "same category, similar price band, same seller bias":
   - `GET /recommendations/fbt?productId=` — top 4 co-ordered products.
   - `GET /recommendations/similar?productId=` — top 8 similar PDPs.
   - `GET /recommendations/for-you` — buyer's last viewed/purchased categories.
3. **GrowthBook-compatible A/B**: `Experiment` + `ExperimentAssignment` schema, `/experiments/features` returns the JSON shape that the GrowthBook SDK already consumes, sticky bucketing per `userId`/`sessionId`, exposure logging.
4. **WCAG 2.1 AA**: focus rings, visible-label associations, alt text on all `<Image>` usages, keyboard nav for buyer-web, dialog `aria-modal` on the AgeGate, language switcher announces `lang`/`dir` correctly. Documented audit checklist; gaps tracked.
5. **k6 load test**: scenarios for home, search, PDP, cart, checkout, and a write-heavy "ten sellers updating inventory" scenario. Targets: 95p < 200 ms at 200 RPS for read paths, 95p < 600 ms at 50 RPS for checkout.
6. **DR runbook**: `doc/dr-runbook.md` covering Postgres PITR restore, MinIO bucket failover, Redis cold-start, BullMQ replay, app-pod blast-radius isolation, RTO/RPO targets, and the on-call playbook for the first 24h after launch.

## 2. Non-goals (intentional, deferred)

- **Real ML recommender** (matrix factorization, embeddings). Phase 8 ships explicit-count co-view and similarity — meaningful at our scale, swappable later. The schema (`ProductCoView`) gives us a labeled dataset on day one.
- **Vector search** in ES. The launch-cluster runs OpenSearch 2.x compatible; vector indices land when we hire a search engineer.
- **Full GrowthBook server**: we ship the *features* endpoint that the GrowthBook front-end SDK consumes, plus exposure logging into our own table. Admins author experiments in our DB; the multi-tenant GrowthBook dashboard isn't worth the operational overhead yet.
- **WCAG AAA** — AA is the launch bar; AAA on color contrast and complex form patterns is post-launch.
- **Chaos engineering** — k6 covers throughput; chaos (network partitions, broker restarts) is a quarterly drill, not a launch dep.

## 3. Data model additions

```
enum ExperimentStatus { DRAFT  RUNNING  PAUSED  CONCLUDED }

model SearchIndexCheckpoint {
  entityType String   @id           // "product"
  lastSeenAt DateTime                // watermark for incremental indexing
}

model ProductCoView {
  id        String   @id
  aId       String                   // canonical ordering: aId < bId
  bId       String
  count     Int      @default(1)
  lastAt    DateTime @default(now())

  a Product @relation("ProductCoViewA", fields: [aId], references: [id], onDelete: Cascade)
  b Product @relation("ProductCoViewB", fields: [bId], references: [id], onDelete: Cascade)

  @@unique([aId, bId])
  @@index([aId, count])
  @@index([bId, count])
}

model Experiment {
  id          String           @id
  key         String           @unique          // human-readable, e.g. "buy_box_v2"
  status      ExperimentStatus @default(DRAFT)
  description String?
  variants    Json             @default("[]")   // [{ id, name, weight }]
  traffic     Int              @default(10000)  // basis points (10000 = 100%)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  assignments ExperimentAssignment[]
}

model ExperimentAssignment {
  id           String   @id
  experimentId String
  experimentKey String
  variantId    String
  userId       String?
  sessionId    String?
  context      Json     @default("{}")  // { country, device, locale, ... }
  assignedAt   DateTime @default(now())

  experiment Experiment @relation(fields: [experimentId], references: [id], onDelete: Cascade)

  @@unique([experimentKey, userId])
  @@unique([experimentKey, sessionId])
  @@index([experimentKey, variantId])
}
```

## 4. Backend modules

```
services/api/src/modules/search/
  search.module.ts
  search.service.ts             # SearchService.search(q, filters, page) — ES first, pg fallback
  search.indexer.ts             # SearchIndexer.indexProduct, .bulkSync, .removeProduct
  search.scheduler.ts           # 5-minute incremental sync (gated by SEARCH_AUTO_SYNC=1)
  es-client.ts                  # tiny SigV4-free fetch wrapper

services/api/src/modules/recommendations/
  recommendations.module.ts
  recommendations.service.ts    # fbt, similar, forYou
  co-view.listener.ts           # @OnEvent('order.paid') aggregates co-purchases
  recommendations.controller.ts # public GETs

services/api/src/modules/experiments/
  experiments.module.ts
  experiments.service.ts        # assign(experimentKey, ctx) + logExposure
  experiments.controller.ts     # GET /experiments/features, POST /experiments/exposure
  admin-experiments.controller.ts
```

## 5. Frontend additions

- **buyer-web PDP**: `<RecommendationsRow type="fbt" />` and `<RecommendationsRow type="similar" />` below the description.
- **buyer-web search**: switches to `/search?query=` → `SearchService.search`. Results show "Did you mean…" when ES returns a suggestion.
- **buyer-web a11y**: `AgeGate` gains `role="dialog"`, `aria-modal`, focus trap. TopBar switchers get `aria-label`. Buttons have explicit `aria-pressed` where toggled.
- **mobile**: PDP gains an FBT row; no other UI changes (mobile is still buyer-only and PDP is the highest-value placement).

## 6. Infra additions

- `infra/perf/k6/` — `read-mix.js`, `checkout.js`, `inventory-burst.js`, plus a `Makefile` to fire them at a target URL.
- `doc/dr-runbook.md` — operational playbook.
- `infra/k8s/helm/onsective/values.yaml` — add an `elasticsearch` env block (`ELASTICSEARCH_URL`, `ELASTICSEARCH_INDEX`) and a one-shot job for `SearchIndexer.bulkSync` on first install.

## 7. Decisions log (Phase 8)

| ID | Decision | Rationale |
| -- | -------- | --------- |
| D-049 | ES-first with PG fallback | We ship ES for relevance and typo-tolerance, but every dev environment can still serve search via Postgres ILIKE. Production sets `ELASTICSEARCH_URL`; everywhere else stays zero-config. |
| D-050 | `ProductCoView` populated from `order.paid` | Order co-purchase is the strongest signal for "buy together". Browse-only co-view is noisy; we defer that until we have analytics-pipeline ingestion. |
| D-051 | GrowthBook *feature payload* compatibility, not full server | Lets us swap to hosted GrowthBook later by pointing the SDK at their endpoint instead of ours, without touching client code. |
| D-052 | Sticky bucketing on `userId` if present, else `sessionId` | Anonymous → bucketed by session; sign-in promotes the assignment to the user without re-bucketing (we keep both keys in the unique index). |
| D-053 | k6 in `infra/perf/k6` (not CI) | k6 runs are heavyweight; we trigger them ad-hoc against staging from `make k6/checkout TARGET=https://api.staging.onsective.com`. Quarterly + pre-launch + post-major-release. |
| D-054 | A11y audit ships as a checklist + targeted fixes | A full WCAG conformance report is a service contract; the checklist + fixes get us above the AA bar for the launch surface. |
| D-055 | DR runbook lives in `doc/`, not the Helm chart | It's documentation, not a manifest. Linked from Grafana dashboards via the on-call rotation tool. |

## 8. Exit criteria

- A buyer typing a misspelled product name in search gets relevance-ranked results when `ELASTICSEARCH_URL` is set; the same query returns the same shape (lower quality) without ES.
- A PDP renders an FBT row for any product with at least one prior co-order, and a similar-PDP row for every product.
- The admin `/experiments` page can create an experiment, set variants + traffic, and the SDK call against `/experiments/features` returns the right shape.
- The k6 `read-mix.js` scenario hits 200 RPS for 60s and reports 95p < 200ms.
- `doc/dr-runbook.md` is checked in.
- `doc/phase-8-debug.md` lists all issues found and fixed.
- Master-plan + PROGRESS show 🟢 on Phase 8 — Onsective is launch-ready.
