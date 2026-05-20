# Phase 17 — Brand Storefronts

Date opened: 2026-05-18
Predecessor: Phase 16 (AI-assisted Authentication & Grading)

## 1. Why this phase

Phases 14–16 made Onsective a certified-only platform with verified
supply. Brands are central to the trust story — every NEW_GENUINE
listing already gates on `BrandAuthorization`. Phase 17 makes the
brand itself a first-class destination: a curated mini-store at
`/brand/<slug>` where buyers can see the brand's story, featured
products, and curated collections — all backed by the same
certification and authenticity guarantees that the rest of the
platform enforces.

**Non-negotiable from prior phases**: no drop-ship. A brand
storefront does not change how inventory moves. A brand either:

1. **Operates as a verified seller** — products are held in Onsective
   warehouses (or the brand's own verified warehouse from Phase 13).
2. **Aggregates authorized resellers** — products from sellers with a
   current `BrandAuthorization` are surfaced under the brand's
   storefront, with stock still physically flowing through warehouses.

Either way, the existing Phase 13 routing + Phase 14 authenticity gate
runs unchanged. Phase 17 is content + presentation, not a new
fulfillment path.

## 2. Scope (in)

### 2.1 Brand mode
- `Brand.mode` enum: `INVENTORY_HOLDING` | `AUTHORIZED_ONLY`.
  - `INVENTORY_HOLDING`: brand has a paired `Seller` row (linked via
    `Brand.sellerId`). The brand-seller can list products directly.
  - `AUTHORIZED_ONLY`: brand has no paired seller; the storefront
    aggregates from authorized resellers.
- Default for existing rows: `AUTHORIZED_ONLY` (safe — no behavior
  change for current data).

### 2.2 Storefront content
Stored on the existing `Brand` row to keep the model simple:
- `heroMediaUrl` — large hero image.
- `heroHeadline` — primary tagline.
- `heroSubcopy` — supporting paragraph.
- `story` — long-form markdown body for the "About" section.
- `accentColor` — single hex color for buttons/badges on the
  storefront (cosmetic; falls back to platform gold if unset).
- `isPublished` — gates the public route. Drafts are admin-visible only.

### 2.3 Curated collections
- `BrandCollection` table: `{ id, brandId, slug, title, subtitle,
  position, createdAt }`. A brand can have multiple collections
  (e.g., "New season", "Best-selling refurbs").
- `BrandCollectionProduct` join table: `{ collectionId, productId,
  position }` — pinned products in display order.
- Listing rules:
  - A product must be ACTIVE and either NEW_GENUINE or REFURB_GRADE_*.
  - A product must have a current authorization OR belong to the
    brand-seller. Other products silently drop from the rendered
    collection (the row stays for resilience against re-authorization).

### 2.4 Aggregate product feed
- `GET /brand/<slug>/products` returns all live products linked to the
  brand by `Product.brandId`, filtered to those whose seller currently
  satisfies the publish gate (Phase 14 brand-auth or brand-seller).
- Same filter logic the existing PDP gate uses — DRY via the existing
  `BrandsService.findActiveAuthorization`.

### 2.5 Public storefront route
- New buyer route `/brand/[slug]` (alongside existing minimal `/brands/[slug]`
  metadata endpoint). The new route renders the hero, story, collections,
  and the live product grid.
- Cards reuse `ProductCard` + Phase 14 `TrustBadge` so the visual
  language is consistent with the rest of the site.
- Returns 404 if the brand is not `isPublished`.

### 2.6 Admin editor
- Admin `/brands/[id]/storefront` page lets admins edit the storefront
  fields and manage collections.
- Collection product picker: admin enters product IDs (simple list for
  Phase 17 — a search picker can come later) and reorders.
- "Publish" toggle gates the public route.

### 2.7 Brand-as-seller bootstrap
- Admin can promote a brand from `AUTHORIZED_ONLY` to
  `INVENTORY_HOLDING` by attaching a Seller. The endpoint takes either
  an existing `sellerId` or a `{ storeName, displayName }` shorthand
  that creates the seller (status `APPROVED`, anchored to an admin
  user — same pattern as Phase 15 house-seller bootstrap).
- The brand-seller automatically holds a long-lived
  `AUTHORIZED_RESELLER` certification for the brand (created on
  bootstrap, expires in 5 years, renewable).

### 2.8 SEO
- The buyer-web brand page sets a meta description from `heroSubcopy`
  truncated, and a canonical URL.
- Sitemap inclusion is deferred (no sitemap infrastructure changes in
  this phase) but the route is fully crawlable.

## 3. Scope (out)

- Brand-self-serve editor (the brand's own users editing their
  storefront). Phase 17 is admin-curated; brand-self-serve is a
  later phase.
- Drop-ship from brand → buyer. Hard out, as per durable constraint.
- Brand-sponsored ad placements on the storefront (Phase 4 ad system
  could plug in later).
- Localized content per locale (we use platform i18n for chrome but
  storefront content stays brand-authored).

## 4. Architectural decisions made up front

### 4.1 Storefront content lives on `Brand`
We add fields directly to `Brand` rather than creating a
`BrandStorefront` 1:1 table. Reasoning: it's effectively 1:1 already,
keeping it on the parent avoids the join, and the fields are small
strings + one nullable JSON. Trade-off: row gets wider; acceptable
since brand reads are not hot.

### 4.2 Collections are normalized
Collections + their product membership are separate tables because
collections aren't 1:1 with brand (a brand can have many) and
product membership has its own position + lifecycle. Indexed by
`brandId` + `position`.

### 4.3 No new role for brand owners (yet)
Editing is admin-only in Phase 17. Adding a `BRAND_OWNER` role would
ripple into auth/RBAC and increase blast radius for what's a
content-management feature. Defer until brands actually ask to
self-edit.

### 4.4 Brand-seller link is on `Brand`
`Brand.sellerId String?` is unique; this is the inverse of having
`Seller.brandId`. We pick the brand side because the lookup direction
that matters is "given a brand, who's the inventory-holding seller?"
not the reverse. A seller can be linked to at most one brand.

### 4.5 Re-use the existing publish-gate logic
The storefront's product feed runs the SAME filter the existing
publish gate uses. We don't introduce a parallel filter — that would
be a second source of truth for "can this seller sell this brand
here?" and risk drift.

## 5. Acceptance criteria

- Admin promotes the existing "Acme" brand to `INVENTORY_HOLDING`,
  bootstrapping a seller `acme-brand` automatically given an
  `AUTHORIZED_RESELLER` cert for Acme.
- Admin edits the Acme storefront: hero image, headline, subcopy,
  story. Adds two collections: "New season" with 3 products, "Best
  refurbs" with 2 products.
- Admin toggles `isPublished` on. Public route `/brand/acme` now
  renders hero + story + both collections + a product grid of all
  live Acme products from Acme (the inventory-holding seller) plus
  any authorized resellers.
- Public route returns 404 when `isPublished` is false.
- Removing a seller's `BrandAuthorization` for Acme immediately
  removes their products from the storefront feed without admin
  action.
- `doc/phase-17-debug.md` captures decisions and limitations.
