# Phase 28 — SEO, Structured Data & Sitemaps

Date opened: 2026-05-19
Predecessor: Phase 27 (In-app Notification Center)

## 1. Why this phase

The buyer-web has been functional but invisible to search engines.
Twenty-seven phases of feature work and a Google bot still gets a
single H1 and zero structured data on any product page. For a
certified-retail platform whose value proposition (verified
refurb units, real warranty months, trade-in flow) is materially
different from a generic marketplace, that means the platform
loses every comparison-shopping query before it starts.

Phase 28 closes that gap with six concrete deliverables:

1. **Dynamic sitemap** — `/sitemap.xml` (index) plus chunked
   per-entity sitemaps for products, brands, categories, outlet
   listings. Chunked at the 50k-URL spec cap.
2. **robots.txt** — explicit disallows for admin / shipping /
   seller portals, search query strings, signed download URLs;
   explicit `Sitemap:` pointer.
3. **Product schema.org JSON-LD** — `Product` with `Offer`,
   `Brand`, `AggregateRating` (when reviews exist), condition
   mapped to schema.org `OfferItemCondition` values.
4. **Brand schema.org JSON-LD** — `Organization` for the brand
   plus an `ItemList` of the storefront's products.
5. **OpenGraph + Twitter Cards** — every PDP, brand page, and
   the outlet index get `og:*` + `twitter:*` metadata via
   Next.js `generateMetadata`.
6. **Canonical URLs** — every public page emits a canonical
   pointing to its query-string-free path.

Together these add real discoverability without touching the
runtime behavior of the platform.

## 2. Scope (in)

### 2.1 SeoService (API)
```
listProductSlugs(after?: string, limit = 5000)
  -> { slugs: string[], cursor: string | null, updatedAt: string }
listBrandSlugs() -> { slugs: string[], updatedAt: string }
listCategorySlugs() -> { slugs: string[], updatedAt: string }
listOutletProductSlugs() -> { slugs: string[], updatedAt: string }
sitemapIndexUrls() -> string[]   // returns absolute URLs for the index
```
All calls filter to ACTIVE / publicly-visible rows only (same
filters Phase 14 and Phase 17 use for the buyer feed).

### 2.2 Sitemap controller
- `GET /seo/sitemap-index.xml` — the index, references the
  child sitemaps.
- `GET /seo/sitemap-products-:n.xml` — chunked at 5,000 URLs
  per chunk (well under the 50k cap; smaller chunks render
  faster).
- `GET /seo/sitemap-brands.xml` — single file (brand count
  stays small).
- `GET /seo/sitemap-categories.xml` — single file.
- `GET /seo/sitemap-outlet.xml` — single file, refreshes more
  often.

All responses: `Content-Type: application/xml`, `Cache-Control:
public, max-age=3600`. No auth.

### 2.3 Buyer-web sitemap proxy
- `/sitemap.xml` is a Next.js route handler that proxies the
  API's `sitemap-index.xml`. We re-emit the response with the
  same Cache-Control and rewrite the absolute child URLs to
  the public buyer-web origin via `NEXT_PUBLIC_BUYER_URL`.

### 2.4 Buyer-web robots.txt
- `/robots.txt` route handler emits:
  ```
  User-agent: *
  Disallow: /account/
  Disallow: /admin/
  Disallow: /checkout
  Disallow: /search?
  Disallow: /verify
  Allow: /

  Sitemap: https://<host>/sitemap.xml
  ```

### 2.5 Per-page metadata (Next.js generateMetadata)
- `/product/[slug]` — title = `${product.title} | Onsective`,
  description = product.summary trimmed to 160 chars, canonical
  = `${BUYER_URL}/product/${slug}`, openGraph image = first
  product media, twitter card type = "summary_large_image".
- `/brand/[slug]` — title = `${brand.name} | Onsective`,
  description = brand.story trimmed, canonical, og.
- `/outlet` — generic but with og image = a curated outlet
  hero.
- `/` and other entry pages get sensible defaults via the root
  layout.

### 2.6 JsonLd components
- A shared `<JsonLd data={...}/>` component that emits a single
  `<script type="application/ld+json">` with safely-serialized
  JSON (escape `</`).
- Used on PDP, brand page, outlet to render the relevant
  schema.org objects.

### 2.7 Product condition mapping
Schema.org `OfferItemCondition` values:
- `NEW_GENUINE` → `https://schema.org/NewCondition`
- `REFURB_GRADE_A/B/C` → `https://schema.org/RefurbishedCondition`
- `OPEN_BOX` → `https://schema.org/UsedCondition` (closest
  match)
- All other conditions → omit the field.

### 2.8 AggregateRating
PDP renders an `AggregateRating` only when the product has at
least one review. Pulled from existing `ReviewsService`
aggregates (already computed for the buyer-facing rating row).

## 3. Scope (out)

- **Per-RefurbUnit detail pages in sitemap.** Each unit is
  transient inventory (sells out the moment a buyer adds to
  cart). Indexing them would churn the sitemap; we surface
  the parent product page instead.
- **News article / blog content.** Out of scope; the platform
  doesn't ship a CMS.
- **hreflang / locale-specific sitemaps.** Phase 6 added i18n
  but locale variants of product pages aren't crawled
  separately yet.
- **Image sitemaps / video sitemaps.** Standard image URLs in
  product OG metadata are enough for v1.
- **Real-time sitemap regeneration on every product publish.**
  We rely on `lastmod` being correct + bot recrawl cadence.
- **Search Console / Bing Webmaster verification HTML files.**
  Operators paste those into env-driven meta tags; the phase
  doesn't ship a UI for it.

## 4. Architectural decisions made up front

### 4.1 Sitemap served by the API, proxied by Next.js
The API has direct DB access and can paginate efficiently.
Next.js's built-in `app/sitemap.ts` would force us to fetch
all slugs in a single edge function, which doesn't scale past
a few thousand products. The API serves the canonical XML and
the buyer-web's `/sitemap.xml` is a thin proxy that handles
host rewriting + caching.

### 4.2 Cache-Control: 1 hour
Search bots crawl on their own schedule; an hour of staleness
is fine. The numbers don't change minute-to-minute for an
e-commerce site.

### 4.3 Chunked products, single-file brands/categories
Products grow without bound; brands and categories are bounded
in real e-commerce ops. We chunk products at 5,000 URLs and
serve brands/categories as single files. The index file ties
them together.

### 4.4 JSON-LD only on indexable pages
We do not emit JSON-LD on `/account/*`, `/admin/*`, or
`/checkout`. Those pages aren't in the sitemap and the
markup would be wasted.

### 4.5 Canonical = no query string
The canonical URL on PDPs is `${BUYER_URL}/product/${slug}` —
never includes the `?ref=`, `?utm_*`, `?variant=` params that
might appear in shared links. Same on brand pages.

### 4.6 OG image = first product media
We don't render a custom OG card. The first product image
(media[0].url) is the OG image; if the platform later adds a
template-rendered OG image service, this is the obvious
swap-out point.

### 4.7 Outlet sitemap is its own file
Outlet listings churn faster than core catalog. Keeping them
in a separate chunked file lets the sitemap-index advertise a
fresher `lastmod` for outlet alone without invalidating the
products cache.

## 5. Acceptance criteria

- `GET /seo/sitemap-index.xml` returns valid XML with
  `<sitemapindex>` listing the child sitemaps with
  `lastmod` ISO timestamps.
- `GET /seo/sitemap-products-1.xml` returns up to 5,000
  `<url>` entries with the buyer-web absolute URL +
  `lastmod` from `Product.updatedAt`.
- `GET /seo/sitemap-brands.xml` returns active brands.
- `GET /seo/sitemap-categories.xml` returns active
  categories.
- `GET /seo/sitemap-outlet.xml` returns products that have
  at least one AVAILABLE RefurbUnit.
- The buyer-web `/sitemap.xml` returns the index with
  child URLs pointing to the buyer-web host.
- The buyer-web `/robots.txt` returns the directives + the
  Sitemap line.
- PDP view-source contains `<script type="application/ld+json">`
  with a valid `Product` schema (validated via Google's
  structured-data testing tool).
- Brand page view-source contains an `Organization`
  schema.
- PDP `og:title`, `og:description`, `og:image`,
  `og:url`, `twitter:card` are all populated.
- Canonical link tag points to the slug URL with no
  query string.
- `doc/phase-28-debug.md` captures decisions + limitations.
