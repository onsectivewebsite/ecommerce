# Phase 41 — Product Collections

> Admin-curated cross-brand product lists ("Editor's picks", "Best for
> dry skin") with their own landing pages and explicit ordering — a
> merchandising surface that complements brand storefronts.

## Goal

A platform-curated way to group products that don't share a brand or
category — themed lists ("Holiday gift guide", "New this week") with a
hero image, intro copy, and a hand-ordered product grid. Distinct from
brand storefronts (Phase 17, single-brand) and Tailwind categories
(taxonomy-driven, automatic).

## Data model

Two models + one enum.

- **`ProductCollection`** — `slug`, `title`, `description?`,
  `heroImageUrl?`, `status` (`DRAFT` / `ACTIVE` / `ARCHIVED`),
  `position` (sort order on the index page), timestamps.
- **`ProductCollectionItem`** — `(collectionId, productId)` unique +
  `position` for the grid order. Cascade-deleted when the collection or
  product is removed.
- **`CollectionStatus`** — `DRAFT` (admin-only), `ACTIVE` (public),
  `ARCHIVED` (kept for history, hidden publicly).

## Invariants

1. **Public reads only see `ACTIVE` collections** — `DRAFT` and
   `ARCHIVED` are admin-only.
2. **Collection slug is unique platform-wide** — used as the public URL
   segment.
3. **`ProductCollectionItem` is idempotent** — re-adding a product is a
   no-op (unique constraint).
4. **Only `ACTIVE` products** are listed on the public page; an item
   pointing at a deactivated product silently drops out.
5. **Ordering is admin-controlled** — both the index (`position` on the
   collection) and the grid (`position` on the item).

## Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET  | `/collections` | public | list active collections |
| GET  | `/collections/:slug` | public | one collection + its active products |
| GET  | `/admin/collections` | ADMIN | full list incl. drafts |
| POST | `/admin/collections` | ADMIN | create |
| PATCH | `/admin/collections/:id` | ADMIN | update fields |
| DELETE | `/admin/collections/:id` | ADMIN | hard-delete (cascades items) |
| POST | `/admin/collections/:id/items` | ADMIN | `{ productId, position? }` |
| DELETE | `/admin/collections/:id/items/:productId` | ADMIN | remove item |
| PATCH | `/admin/collections/:id/items/:productId` | ADMIN | reorder `{ position }` |

## Frontend

- **buyer-web** — `/collections` (index page, cards for each active
  collection), `/collections/[slug]` (hero + intro + product grid using
  `ProductCard`). Top-bar link.
- **admin-web** — `/collections` (list + inline create + edit + add /
  remove / reorder products via a per-collection panel) + nav entry.

## Decisions

- **Cross-brand, admin-curated** — explicitly different from brand
  storefronts (one brand each) and from category pages (taxonomy-driven).
  This is the merchandising surface for editorial-style groupings.
- **Position-based ordering, not pinned/featured flags.** A single
  `position` integer is enough to express the grid order and avoids
  competing "featured" mechanics.
- **Slug is the public identifier.** The numeric id is admin-only; URLs
  use the human-readable slug.
- **No buyer interactions.** Collections are read-only for buyers; no
  follow / save / share. Discovery is via the index page or admin
  promotion (e.g. a Phase-40 announcement linking to a collection).
