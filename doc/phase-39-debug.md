# Phase 39 — Saved Searches — Debug Pass

> What shipped, the invariants, every endpoint, and the deferred follow-ons.

## What shipped

- **Two models** (`SavedSearch`, `SavedSearchHit`) + `NotificationKind.SAVED_SEARCH_MATCH`.
- **`SavedSearchesService`** — create, list (with hit counts), delete,
  `runOnce` (per-search evaluation), `scan` (scheduler entry point).
- **`SavedSearchesScheduler`** — hourly, env-gated by
  `SAVED_SEARCH_SCHEDULER_ENABLED=1`.
- **Matching** — direct Prisma ILIKE on `Product.title` / `Product.description`
  for products with `status = ACTIVE`; no Elasticsearch dependency.
- **Notifications** — one summary feed entry per saved search per scan
  ("`N new matches for ‘…’`" + top 3 titles), deep-linking to
  `/search?query=…`.
- **Frontend** — `SaveSearchButton` on `/search` (when a query is present);
  `/account/saved-searches` to list / re-run / delete; account tile.

## Invariants

1. **One notification per saved search per scan** — never one per product.
2. **Each `(savedSearchId, productId)` pair notifies at most once** — the
   unique index makes dedupe atomic; rescans never re-notify.
3. **Only `ACTIVE` products** can produce a match; a deactivated product
   stops appearing in future scans and never re-notifies if it comes back
   (the existing hit row guards it).
4. **Buyer-scoped** — saved searches require sign-in; deletion is the only
   off switch.
5. **`runOnce` is idempotent** — re-running for the same saved search
   without new catalog activity produces zero new hits and zero
   notifications.

## Endpoint inventory

| Method | Path | Auth |
|--------|------|------|
| GET | `/saved-searches` | JWT |
| POST | `/saved-searches` | JWT |
| DELETE | `/saved-searches/:id` | JWT |
| POST | `/admin/saved-searches/scan` | ADMIN |

## Schema additions

- `SavedSearch`, `SavedSearchHit` models.
- `NotificationKind.SAVED_SEARCH_MATCH`.
- `User.savedSearches`, `Product.savedSearchHits` back-relations.

## Manual test list

1. **Save.** `/search?query=serum` → "Save this search" → appears in
   `/account/saved-searches`.
2. **Initial scan.** `POST /admin/saved-searches/scan` → existing matching
   products are recorded as hits (back-fill); a notification fires for the
   count.
3. **Re-scan.** Trigger scan again → no new hits, no notification.
4. **New product matches.** Seller publishes a new product with the query
   in its title → next scan adds one hit and writes one feed entry.
5. **Dedupe.** Manually delete a hit row then re-scan — the row is
   recreated; notification fires only because a "new" match was found.
   (In practice this isn't reachable from the UI.)
6. **Delete.** Delete the saved search → hits cascade-delete; no further
   scans for it.

## Decisions worth highlighting

- **Postgres ILIKE matching** rather than an Elasticsearch round-trip —
  the feature works in deployments without an ES cluster, which is the
  current production state.
- **One notification per scan**, not per product — popular queries would
  otherwise drown the buyer.
- **Append-only hits.** A deactivated-then-reactivated product never
  re-notifies; the hit row is the historical record.
- **Minimal model** — no `filters` JSON, no pause/resume. The current
  `/search` UI exposes only a query, so saved-searches mirror that
  surface. A future search-with-filters UI can extend without a schema
  break (just add `filters Json?`).

## Limitations / follow-ons

- **No filter dimensions** (category / brand / price range / condition) —
  matches are purely on query text.
- **No real-time on-publish notification** — the alert is hourly, driven
  by the scheduler; a new product appears in saved-search results at most
  one tick after listing.
- **No anonymous saving** — a guest can't save a search without signing in.
- **No email digest** — alerts land in the in-app feed; the email channel
  is unused so far.
