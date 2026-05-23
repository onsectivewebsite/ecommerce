# Phase 38 — Product Comparison — Debug Pass

> What shipped, the invariants, every endpoint, and the deferred follow-ons.

## What shipped

- **One model** (`ComparisonItem`) — `(userId, productId)` unique, no enum,
  no lifecycle.
- **`ComparisonService`** — `list` (hydrates each product with image, price,
  condition, brand, seller, category, stock, review rating, and the
  `attributes` map), `add` (idempotent, capped at 4), `remove`, `clear`.
- **`/comparison` endpoints** — JWT-only; add/remove return the refreshed
  list so the client never needs a second round-trip.
- **Frontend** — `CompareButton` on the PDP (toggle + live count + link),
  `/compare` side-by-side table (one column per product, a row per fixed
  field plus a row per attribute key), a "Compare" top-bar link.

## Invariants

1. **At most 4 products** per buyer — a fifth `add` throws a 400 with a clear
   message; the existing four are untouched.
2. **`add` is idempotent** — the unique `(userId, productId)` means re-adding
   is a no-op (and does not count against the cap twice).
3. **Only `ACTIVE` products** can be added; `list` re-filters on product
   status, so a product later pulled from the catalog silently drops out.
4. **Read-only** — comparison touches no cart, pricing, or inventory state.
5. **Per-buyer, server-side** — the set follows the buyer across devices;
   comparison requires sign-in.

## Endpoint inventory

| Method | Path | Auth |
|--------|------|------|
| GET | `/comparison` | JWT |
| POST | `/comparison/:productId` | JWT |
| DELETE | `/comparison/:productId` | JWT |
| DELETE | `/comparison` | JWT |

## Schema additions

- `ComparisonItem` model.
- `User.comparisonItems`, `Product.comparisonItems` back-relations.

## Manual test list

1. **Add from PDP.** Sign in, open a product, "Add to compare" → button flips
   to "✓ In comparison", count shows 1.
2. **Compare page.** Visit `/compare` → the product appears as a column with
   price, condition, brand, seller, rating, stock, and attribute rows.
3. **Cap.** Add a 5th product → 400 "You can compare up to 4 products".
4. **Idempotent add.** Re-add a product already in the set → no duplicate,
   count unchanged.
5. **Remove / clear.** Remove one column, then "Clear all" → empty state.
6. **Attribute union.** Compare two products with different `attributes`
   keys → every key gets a row, blank ("—") where a product lacks it.
7. **Stale product.** Deactivate a compared product → it drops from `/compare`
   on the next load.

## Decisions worth highlighting

- **Server-side, per-buyer** rather than `localStorage` — consistent with
  wishlists and survives across devices, at the cost of requiring sign-in.
- **`add`/`remove` return the full refreshed list** — the PDP button and the
  compare page both want current state; returning it avoids a follow-up GET.
- **Attribute rows are the union of keys** — products needn't share a schema;
  a missing key renders "—" so columns still line up.
- **Cap of 4** — a wider table stops being scannable; the conventional retail
  comparison limit.

## Limitations / follow-ons

- **No "Compare" control on product cards / listings** — the only entry point
  is the PDP. A card-level toggle would let buyers build the set faster.
- **No anonymous comparison** — the set is JWT-only; a guest can't compare
  without signing in.
- **No persisted column ordering** — products show in add order; the buyer
  can't reorder columns.
- **Attribute values are stringified as-is** — nested objects/arrays in the
  `attributes` JSON render with `String()`, not a structured view.
