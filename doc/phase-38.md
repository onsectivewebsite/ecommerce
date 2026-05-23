# Phase 38 — Product Comparison

> A side-by-side comparison table so a shopper can weigh up to four products
> on price, condition, brand, rating, stock, and key attributes.

## Goal

A buyer deciding between similar products should be able to line them up and
compare at a glance instead of flipping between tabs. They add products to a
comparison set from the product page; `/compare` renders them side by side.
The set is server-side and per-buyer, so it survives across devices.

## Data model

One model, no enum.

- **`ComparisonItem`** — `userId`, `productId`, `createdAt`. A unique
  `(userId, productId)` makes "add" idempotent. The set is capped at **4**
  products (enforced in the service).

There is no status/lifecycle — an item is either in the set or removed.

## Invariants

1. **At most 4 products** in a buyer's comparison set — a fifth `add` is
   rejected with a clear message.
2. **Add is idempotent** — the unique constraint means re-adding a product is
   a no-op, not a duplicate or an error.
3. **Only `ACTIVE` products** can be added; a product that later leaves the
   catalog simply stops appearing in the comparison list (the join filters on
   product status at read time).
4. **The set is purely a shopping aid** — it never affects cart, pricing, or
   inventory.

## Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/comparison` | JWT | the buyer's comparison products, fully hydrated |
| POST | `/comparison/:productId` | JWT | add (idempotent, cap 4) |
| DELETE | `/comparison/:productId` | JWT | remove one |
| DELETE | `/comparison` | JWT | clear the set |

`GET /comparison` returns each product hydrated with the fields the table
needs: title, slug, image, price, currency, condition, brand, seller, stock
status, review rating + count, and the product's `attributes` map.

## Frontend

- **buyer-web** — a `CompareButton` on the PDP toggles the product in/out of
  the set and reflects the current count. `/compare` renders the side-by-side
  table: one column per product, rows for image, price, condition, brand,
  seller, rating, stock, then a row per attribute key (the union across the
  compared products). Each column has a remove control; a "clear all" action
  empties the set. A "Compare" link in the top bar reaches the page.

## Decisions

- **Server-side, per-buyer set** rather than `localStorage` — consistent with
  wishlists, and it follows the buyer across devices. Comparison is JWT-only;
  an anonymous shopper signs in to use it.
- **Cap of 4** — a comparison table wider than four columns stops being
  scannable on a normal screen; four is the conventional retail limit.
- **Attribute rows are the union of keys** across the compared products, with
  a blank cell where a product lacks a key — so dissimilar products still
  line up without the table assuming a shared schema.
- **No cart/pricing coupling** — comparison is deliberately read-only; it
  reuses catalog and review data and introduces no checkout risk.
