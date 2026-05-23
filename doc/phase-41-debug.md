# Phase 41 — Product Collections — Debug Pass

> What shipped, the invariants, every endpoint, and the deferred follow-ons.

## What shipped

- **Two models** (`ProductCollection`, `ProductCollectionItem`) + one
  enum (`CollectionStatus`: `DRAFT` / `ACTIVE` / `ARCHIVED`).
- **`CollectionsService`** — `publicList`, `publicGetBySlug` (hydrated
  with product card data), admin `list / get / create / update / remove`,
  per-item `addItem / removeItem / reorderItem`.
- **Two controllers** — no-auth `/collections` (list + slug detail);
  ADMIN `/admin/collections/*`.
- **Slug-keyed public URLs** — buyer-web `/collections` (index) and
  `/collections/[slug]` (detail). Top-bar link.
- **Admin UI** — `/collections`: list + create + per-collection panel for
  status changes, delete, and add / remove / reorder products by id.

## Invariants

1. **Public reads only see `ACTIVE` collections** — `DRAFT` and
   `ARCHIVED` are admin-only; `publicGetBySlug` 404s on non-active.
2. **Slug is unique platform-wide** — create / update enforce; a
   collision throws 409.
3. **`addItem` is idempotent** — `upsert` on `(collectionId, productId)`;
   re-adding moves the item to the new position rather than duplicating.
4. **Only `ACTIVE` products** appear on the public collection page; an
   item pointing at a deactivated product silently drops out (still
   listed in admin with its status badge so an admin can decide).
5. **Position-based ordering** — both the index (`ProductCollection.position`)
   and the grid (`ProductCollectionItem.position`) are admin-controlled
   integers, sorted ascending, with `createdAt` as the deterministic
   tie-breaker.

## Endpoint inventory

| Method | Path | Auth |
|--------|------|------|
| GET  | `/collections` | public |
| GET  | `/collections/:slug` | public |
| GET  | `/admin/collections` | ADMIN |
| GET  | `/admin/collections/:id` | ADMIN |
| POST | `/admin/collections` | ADMIN |
| PATCH | `/admin/collections/:id` | ADMIN |
| DELETE | `/admin/collections/:id` | ADMIN |
| POST | `/admin/collections/:id/items` | ADMIN |
| DELETE | `/admin/collections/:id/items/:productId` | ADMIN |
| PATCH | `/admin/collections/:id/items/:productId` | ADMIN |

## Schema additions

- `ProductCollection`, `ProductCollectionItem` models.
- `CollectionStatus` enum.
- `Product.collectionItems` back-relation.

## Manual test list

1. **Create draft.** Admin /collections → create with slug `editor-picks`
   → appears in admin list as `DRAFT`; public `/collections` does not
   show it.
2. **Add products.** Open the editor, paste a product id, add → item
   appears in the panel.
3. **Activate.** Set `ACTIVE` → public `/collections` index shows it;
   `/collections/editor-picks` renders hero + grid.
4. **Reorder.** Change a product's `position` integer → public page
   reorders on next load.
5. **Re-add idempotency.** Add the same product id again with a
   different position → row updates (no duplicate, no 409).
6. **Archive.** Set `ARCHIVED` → public detail 404s; admin list still
   shows it.
7. **Cascade on product delete.** Remove a product from the catalog → the
   item drops from the collection automatically.

## Decisions worth highlighting

- **Cross-brand, admin-curated** — explicitly different from brand
  storefronts (Phase 17, one brand) and from category pages (taxonomy).
- **Slug-keyed URLs** — human-readable + linkable. Slug change is a
  conscious admin action (validated, uniqueness-checked) so the public
  URL changes deliberately.
- **No buyer interactions on collections** — they're a read-only
  merchandising surface. Saving / following collections is out of scope.
- **`upsert` on add** instead of strict-create — admins want fast,
  forgiving editing; idempotent add is the right ergonomic.

## Limitations / follow-ons

- **Add-by-id only in admin UI** — admins paste a product id; there is
  no in-context catalog picker yet.
- **No drag-and-drop reorder** — positions are integers in a small input.
- **No per-collection landing copy beyond a single `description`** — no
  rich blocks, no per-section storytelling.
- **No analytics** — clicks-through to PDPs aren't tracked yet.
- **No localization** — `title` / `description` are single-locale.
