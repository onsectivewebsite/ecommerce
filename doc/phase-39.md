# Phase 39 — Saved Searches

> A shopper saves a search query and is notified when new products start
> matching it — turning the search box into a standing alert.

## Goal

Persistent search alerts. A buyer types "wireless earbuds" on `/search`, hits
**Save this search**, and walks away. From then on, an hourly scheduler
re-runs the query against the catalog; the first time a newly-listed product
matches, the buyer gets a notification with a deep link back to the live
results. Buyers manage their saved queries on `/account/saved-searches`.

## Data model

Two models + one enum addition.

- **`SavedSearch`** — `userId`, `q` (the query string), optional `name`,
  `lastCheckedAt`, timestamps.
- **`SavedSearchHit`** — `(savedSearchId, productId)` unique. Records which
  products this saved search has already matched, so the buyer is never
  notified about the same product twice.
- **`NotificationKind.SAVED_SEARCH_MATCH`** — for the feed entry the
  scheduler writes when new matches appear.

## Matching

A direct Prisma scan against `Product` — `status = ACTIVE` and either `title`
or `description` ILIKE-contains the query. No Elasticsearch dependency: the
saved-search feature works whether the cluster is configured or not. The
scheduler diffs the result against `SavedSearchHit`, inserts rows for new
matches, and emits **one notification per scan** summarising the count + the
top three titles — never one notification per product.

## Invariants

1. **One notification per saved search per scan**, regardless of how many
   new matches landed — the buyer never gets flooded.
2. **Each (savedSearch, product) pair notifies at most once** — the unique
   `SavedSearchHit` index makes the dedupe atomic; a re-scan never
   re-notifies.
3. **Only `ACTIVE` products** can match. A product later pulled from the
   catalog is no longer considered for new alerts; its existing hit row
   stays so it isn't re-notified if it later returns.
4. **Buyer-scoped** — saved searches require sign-in. Deletion is the only
   "off" switch (no pause/resume; the model stays minimal).

## Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/saved-searches` | JWT | my saved searches with hit counts |
| POST | `/saved-searches` | JWT | `{ q, name? }` — `q` ≥ 2 chars |
| DELETE | `/saved-searches/:id` | JWT | remove (deletes hits too) |
| POST | `/admin/saved-searches/scan` | ADMIN | on-demand scan (dev / ops) |

The scheduler runs hourly when `SAVED_SEARCH_SCHEDULER_ENABLED=1`.

## Frontend

- **buyer-web** — a `SaveSearchButton` on `/search` (visible only when a query
  is present) captures the current query. `/account/saved-searches` lists the
  buyer's saved searches with their hit counts, a "Run now" link back to
  `/search?query=…`, and a delete control. Account tile linking in.

## Decisions

- **Postgres ILIKE, not Elasticsearch.** Direct Prisma keeps the feature
  decoupled from the optional ES cluster and works in every deployment.
  The match set is small (a single buyer's saved query), so the cost is
  fine; if ES becomes the search backbone, the matcher can swap to it
  behind the same service interface.
- **One summary notification per scan**, not per product. A buyer with a
  popular query would otherwise drown — a single "3 new matches for X"
  entry is far more usable than three.
- **Hits are append-only** — never deleted on product deactivation. If the
  product later returns to `ACTIVE`, the buyer isn't re-notified about
  something they already know about.
- **No filters in v1.** The `/search` page itself doesn't expose filter
  controls today; saved searches mirror that minimum surface. Filters can
  ride on a `filters` JSON later without a schema break.
