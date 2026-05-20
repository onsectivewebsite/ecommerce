# Phase 28 — Debug Pass

Companion to `phase-28.md`. Decisions made, seams to watch, what to
test before merging.

## 1. The invariants Phase 28 preserves

1. **Sitemap entries are public-only.** Every query filters
   `status: 'ACTIVE'` for products and `isPublished: true` for
   brands. DRAFT products and unpublished brands never leak.
2. **JSON-LD never includes auth-protected URLs.** All emitted
   `url` / `loc` fields are public buyer-web paths.
3. **Canonicals are query-string-free.** The PDP canonical
   points to `/p/<slug>`, never the `?ref=` or `?variant=`
   variants that show up in shared links. Brand pages and
   outlet similarly canonicalize to their base path.
4. **Robots disallows all signed-in surfaces.** `/account/`,
   `/admin/`, `/checkout`, `/track`, `/verify`, and
   `/search?...` are all disallowed. Bots crawl only catalog,
   brand, outlet, category, and homepage.
5. **JSON-LD is HTML-safe.** `<JsonLd>` escapes `<`, `>`, `&`,
   ` `, ` ` so a stored title with `</script>` in it
   can't break out.

## 2. Non-obvious decisions

### 2.1 API serves the canonical XML, buyer-web is a proxy
We do NOT use Next.js's built-in `app/sitemap.ts` because that
forces fetching every product slug in a single edge-function
call. The API has direct DB access, paginates efficiently, and
caches the response. The buyer-web's `/sitemap.xml` is a 30-line
proxy that re-emits with the right Cache-Control.

### 2.2 Chunked at 5,000 URLs
Sitemap spec allows 50,000 URLs per file; we chunk at 5,000.
Smaller chunks parse faster, fail in smaller blast radii if
serialization breaks for one row, and let the catalog grow to
~100k products before we need to revisit chunk sizing. The
index file ties them together so bots discover all chunks.

### 2.3 Categories use createdAt as lastmod
`Category` doesn't have `updatedAt` in the existing schema; we
use `createdAt` instead. Acceptable because categories rarely
change. If a category's slug is renamed it gets a new row.

### 2.4 Outlet sitemap is its own file
Outlet RefurbUnits churn fast (sold means removed from listing).
A separate file lets the index advertise a fresher `lastmod`
for outlet without invalidating the bulk catalog cache.

### 2.5 No per-RefurbUnit pages in sitemap
Each unit is transient inventory. Indexing per-unit pages
would churn the sitemap and produce 404s as soon as units
sell. We surface the parent product page instead, which
contains the per-unit picker live.

### 2.6 AggregateRating is omitted
`ProductDetailDto` doesn't currently carry `ratingAverage` /
`ratingCount`. We omit `AggregateRating` from the JSON-LD; the
rest of the Product schema is valid without it. Adding the
aggregate fields to the DTO is a small follow-up.

### 2.7 PDP price = cheapest available refurb unit, else base
For refurb products we pull the cheapest AVAILABLE RefurbUnit
price and use it as the Offer price. If no units are available,
the basePrice is used and `availability` flips to
`OutOfStock`. NEW_GENUINE products always use `basePriceMinor`.

### 2.8 Condition mapping
- `NEW_GENUINE` → `schema.org/NewCondition`
- `REFURB_GRADE_A/B/C` → `schema.org/RefurbishedCondition`
- `OPEN_BOX` → `schema.org/UsedCondition`

The closest match for OPEN_BOX in schema.org's vocabulary is
`UsedCondition` — the spec doesn't have a dedicated "open box"
value.

### 2.9 BUYER_WEB_URL is required for absolute URLs
The API builds absolute URLs in the sitemap chunks using
`BUYER_WEB_URL`. The buyer-web also uses `NEXT_PUBLIC_BUYER_URL`
for canonical and OG URLs. Setting both is mandatory in
production; defaults to `localhost` in dev.

### 2.10 OG image = first product media
We don't render a custom OG card. The first product image is
the OG image. A template-rendered OG image service can be
swapped in by replacing `metadata.openGraph.images` in
`generateMetadata`.

### 2.11 Sitemap files are uncached behind 1-hour CDN
`Cache-Control: public, max-age=3600` is conservative. Search
bots crawl on their own cadence; an hour of staleness is fine.

## 3. Things to test end-to-end

- `curl -s http://localhost:4000/seo/sitemap-index.xml | xmllint
  --noout -` → valid XML, lists product chunks + brands +
  categories + outlet.
- `curl -s http://localhost:4000/seo/sitemap-products-1.xml` →
  up to 5,000 `<url>` entries pointing to `/p/<slug>` on the
  buyer-web origin.
- `curl -s http://localhost:3000/sitemap.xml` returns the same
  index but served from the buyer-web origin.
- `curl -s http://localhost:3000/robots.txt` → directives with
  the expected disallows + `Sitemap:` pointer.
- View source on `/p/<slug>` → contains `<script type=
  "application/ld+json">` with a Product schema. Paste into
  https://search.google.com/test/rich-results → no errors.
- View source on `/brand/<slug>` → contains Organization +
  ItemList JSON-LD.
- View source on `/outlet` → contains ItemList JSON-LD.
- Inspect HTTP response headers on `/p/<slug>` →
  `og:title`, `og:description`, `og:image`, `og:url`,
  `twitter:card` are all populated.
- Canonical link on `/p/<slug>?ref=abc` points to
  `/p/<slug>` without the query string.
- Brand canonical: `/brand/<slug>?utm_source=ad` →
  canonical points to `/brand/<slug>`.
- Verify the brand sitemap excludes unpublished brands
  (set `isPublished=false` on a brand → it disappears from
  `/seo/sitemap-brands.xml`).
- Verify the product sitemap excludes DRAFT products.

## 4. Known limitations

- **No AggregateRating** until ProductDetailDto exposes
  `ratingAverage` / `ratingCount`. Follow-up.
- **No image sitemap.** Standard image URLs in OG metadata
  are present, but a dedicated image sitemap could boost
  Google Images visibility.
- **No hreflang.** Phase 6 i18n routes by locale via
  Accept-Language; we don't emit locale-specific sitemap
  variants yet.
- **No video sitemap / VideoObject JSON-LD.** Product video
  media isn't surfaced separately.
- **No Search Console verification meta.** Operators paste
  the verification token into env-driven layout metadata if
  needed; phase doesn't ship a UI.
- **Sitemap chunk N is `skip * 5000`** which is fine at our
  scale but past ~50k products may benefit from keyset
  pagination on id.
- **Categories `lastmod` uses createdAt** (see §2.3).
- **OG image uses raw product media URL.** No custom card
  template.
- **`/search?` is disallowed but the search page itself is
  not.** Bots can still index the homepage; the disallow
  prevents only query-string variants.

## 5. Files added

- `services/api/src/modules/seo/seo.service.ts`
- `services/api/src/modules/seo/seo.controller.ts`
- `services/api/src/modules/seo/seo.module.ts`
- `apps/buyer-web/src/app/sitemap.xml/route.ts`
- `apps/buyer-web/src/app/robots.txt/route.ts`
- `apps/buyer-web/src/components/JsonLd.tsx`

## 6. Files edited

- `services/api/src/app.module.ts` — registered `SeoModule`.
- `apps/buyer-web/src/lib/env.ts` — `PUBLIC_BUYER_URL` constant.
- `apps/buyer-web/src/app/p/[slug]/page.tsx` —
  `generateMetadata` with canonical/OG/Twitter; PDP renders
  schema.org Product JSON-LD with Offer + Brand mapping.
- `apps/buyer-web/src/app/brand/[slug]/page.tsx` — upgraded
  `generateMetadata` with absolute canonical + OG; renders
  Organization + ItemList JSON-LD.
- `apps/buyer-web/src/app/outlet/page.tsx` — upgraded
  `generateMetadata`; renders ItemList JSON-LD.

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm -r typecheck
pnpm -r build
```

No schema migration needed. Required env additions:

```
BUYER_WEB_URL=https://app.onsective.com           # API uses this for sitemap absolute URLs
NEXT_PUBLIC_BUYER_URL=https://app.onsective.com   # Buyer-web uses this for canonical + OG
API_PUBLIC_URL=https://api.onsective.com          # API uses this for the sitemap index references
```

In dev these all default to localhost — sitemap URLs will point
at `http://localhost:3000` which is fine for local testing.
