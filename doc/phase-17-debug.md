# Phase 17 — Debug Pass

Companion to `phase-17.md`. Decisions made, seams to watch, what reviewers
should test.

## 1. The invariant Phase 17 preserves

**No drop-ship.** Phase 17 changes presentation (storefront content +
collections + product feed) but not fulfillment. Every product surfaced
on a brand storefront still flows through the Phase 13 routing and the
Phase 14 authenticity gate. There is no new code path where a brand
ships directly to a buyer without warehouse intake.

The publish-gate filter (`BrandsService.filterProducts`) is the SAME
gate `assertCanPublishNewGenuine` enforces. We deliberately reuse it
rather than duplicate, so there's no risk of one allowing what the other
forbids.

## 2. Non-obvious decisions

### 2.1 Storefront content on the Brand row, not a separate table
Hero, headline, subcopy, story, accent color, isPublished — all added
directly to `Brand`. Reasoning: effectively 1:1, avoids a join on the
hot public-read path, fields are small. The row gets wider but brand
reads are not hot.

### 2.2 Collections are normalized
`BrandCollection` + `BrandCollectionProduct` are separate tables
because collections aren't 1:1 with brand (many per brand) and
membership has its own position + lifecycle. Indexed by `brandId +
position` for ordered render.

### 2.3 Brand-seller link lives on Brand, not Seller
`Brand.sellerId String? @unique` is the inverse of having
`Seller.brandId`. We picked the brand side because the lookup that
matters at runtime is "given a brand, who's the inventory-holding
seller?" — used in `filterProducts` and `assertCanPublishNewGenuine`.
The reverse direction (seller → brand) exists as a relation but isn't
hot.

### 2.4 Brand-seller is implicitly authorized
The Phase 14 publish gate now short-circuits: if the seller IS the
brand's paired seller, no separate `BrandAuthorization` row is needed.
Without this, every inventory-holding brand would need to write a
useless self-authorization for every (brand, category) pair. The
short-circuit is in `assertCanPublishNewGenuine`.

### 2.5 attachSeller bootstrap pattern matches Phase 15
Same pattern as the trade-in house-seller: lazy creation of a seller
row anchored to the first admin user, then auto-issue a 5-year
`AUTHORIZED_RESELLER` cert. Reusing the pattern keeps the bootstrap
story consistent across phases.

### 2.6 Story format is plain text/markdown, rendered as whitespace-pre
The buyer storefront renders the story with `whitespace-pre-line`
rather than running a markdown parser. Reasoning: avoids adding a
markdown dep + XSS surface; admin-only authoring means the trust
boundary is internal. If brands eventually self-edit, swap in a
sanitized markdown renderer.

### 2.7 Publish gate runs at read time
`storefront()` re-evaluates authorization on every read. Trade-off:
slight extra query per public read; benefit: revoking an
authorization removes products from the storefront immediately
without any admin action or cache invalidation. Caching could go on
top later if read volume warrants it.

### 2.8 No `BRAND_OWNER` role yet
Editing is admin-only. Adding a brand-owner role would ripple into
auth/RBAC and increase blast radius. Defer until brands ask for
self-edit.

## 3. Things to test end-to-end

- Create a brand "Acme" in `AUTHORIZED_ONLY` mode.
- Authorize seller X for (Acme, phones) until next year.
- Seller X publishes a NEW_GENUINE iPhone with brandId=Acme.
- Admin opens `/brands/<acme-id>/storefront`, sets hero + story,
  creates a "New season" collection with the published product.
- Admin clicks Publish → public route `/brand/acme` renders hero +
  story + collection card + product grid.
- Revoke seller X's BrandAuthorization → reload public storefront →
  product disappears from both the collection and the grid without
  any other action.
- On the same brand, click "Attach an inventory-holding seller" with
  storeName `acme-brand` displayName `Acme Brand` → brand promotes
  to `INVENTORY_HOLDING`, gets a new seller row, gets a 5-year
  `AUTHORIZED_RESELLER` cert. Verify in `/certifications`.
- Brand-seller now publishes a NEW_GENUINE product with brandId=Acme
  without writing any BrandAuthorization → publishes successfully.
- The product appears on `/brand/acme` immediately.
- Unpublish the brand → public route returns 404.

## 4. Known limitations

- No collection product picker — admin pastes product IDs. A search
  picker is straightforward but deferred.
- Admin brands list doesn't paginate. Fine for tens; address when
  brand counts grow.
- Storefront doesn't include sponsored / ad placements yet. Phase 4
  ads can plug in via a future iteration.
- No localized content per locale. Story + hero fields are single-
  language.
- Sitemap inclusion is deferred — no platform-wide sitemap update
  in this phase. Pages are crawlable but not advertised.

## 5. Files added

- `apps/buyer-web/src/app/brand/[slug]/page.tsx`
- `apps/admin-web/src/app/brands/[id]/storefront/page.tsx`

## 6. Files edited

- `services/api/prisma/schema.prisma` — added `BrandMode` enum,
  storefront fields on `Brand`, `Brand.sellerId`, `BrandCollection`,
  `BrandCollectionProduct`. Back-relations on `Seller`, `Product`.
- `services/api/src/modules/brands/brands.service.ts` — added
  storefront/collection/attachSeller methods + `filterProducts`
  helper. `assertCanPublishNewGenuine` now short-circuits for the
  brand-seller.
- `services/api/src/modules/brands/brands.controller.ts` — new
  endpoints for storefront read + edit + collection management +
  attach-seller.
- `services/api/src/modules/brands/dto.ts` — DTOs for the above.
- `packages/api-client/src/endpoints/brands.ts` — `BrandStorefront`,
  `BrandCollectionRow`, `BrandMode` and corresponding API methods.
- `apps/buyer-web/src/components/TrustBadge.tsx` — accept string
  condition with graceful fallback (so the storefront grid can pass
  raw `condition` strings).
- `apps/admin-web/src/app/brands/page.tsx` — added mode badge,
  publish badge, and link to storefront editor.

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_17_brand_storefronts
pnpm -r typecheck
pnpm -r build
```

The migration adds two new tables and one enum. No data backfill
needed — existing brands get `mode=AUTHORIZED_ONLY` and
`isPublished=false` defaults, so behavior is unchanged for any brand
the admin hasn't explicitly published.
