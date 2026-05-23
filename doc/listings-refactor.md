# Listings Refactor — Product → Product + ProductListing

> Multi-session refactor to introduce per-seller listings on a shared
> canonical product, enabling Buy Box, "other sellers" panels, and true
> Amazon-style marketplace dynamics. Today one Product = one Seller.

## Why

The current schema attaches `sellerId` directly to `Product`, so multiple
sellers cannot offer the same item. Without that, there is no Buy Box to
win and the platform is operationally a shop-per-seller, not a marketplace.

## Target shape

- **`Product`** = canonical item description: title, description, GTIN,
  category, brand, images, attributes. **No** sellerId, price, or
  inventory at this level.
- **`ProductListing`** = one seller's offer on a Product: price, condition,
  fulfillment mode, status. Inventory and order lines key to listings.
- **Buy Box winner** = the single listing chosen per product per request to
  receive the "Add to cart" CTA.

## The 5 steps

| Step | Scope | Risk | Status |
|---|---|---|---|
| **1** | Schema: add `ProductListing` + `ListingStatus`. Backfill one listing per existing product. Old `Product.sellerId / basePriceMinor / condition / fulfillmentMode` stay; nothing reads from listings yet. | ⚪ none | ✅ done |
| **2** | `BuyBoxService` + `GET /buybox/:productId` returns the single winning listing (trivial while there's still one per product). PDP `ProductBuyBox` reads it. Cart/checkout still on legacy path. | 🟡 low | pending |
| **3** | Cart + Order refactor: `OrderItem.listingId`, cart line points at a listing, multi-listing carts split into one Order per seller at checkout. In-flight carts migrated. **Breaking change** to OrderItem schema; needs a release window. | 🔴 high | pending |
| **4** | Seller-web "List on existing product" flow (search canonical catalog, declare price/condition/SKU). Removes the per-seller forced uniqueness on Product. | 🟡 medium | pending |
| **5** | Real Buy Box ranking — price/fulfillment/health/stock/delivery — with per-region scoring + tie rotation. "Other sellers" panel on PDP. Repricer for sellers (later). | 🟡 medium | pending |

## Invariants the refactor must preserve

1. **No double-sells.** Inventory reservation locks (your existing
   `InventoryReservation` model) still apply, just keyed to listing.
2. **One Order per seller.** A multi-seller cart produces multiple Orders
   at checkout, each with its own commission/payment/shipment. The buyer
   sees them stitched in the UI as "order placed", but the data underneath
   is split — this is how Amazon does it and the only way refunds, returns,
   and payouts stay sane.
3. **Reviews stay on Product**, not Listing. A 4.5-star product is 4.5
   stars no matter who sells it; that's the canonical-catalog promise.
4. **Q&A stays on Product**, same reason.
5. **Wishlists, Comparison, Saved Searches, Recommendations** stay
   product-keyed.
6. **Buy Box winner cache TTL ≤ 60s**, invalidated on
   price/stock/seller-health changes (BullMQ-friendly when we move off
   `setInterval`).

## Step 1 deliverables (this session)

- `ProductListing` model + `ListingStatus` enum.
- `Product.listings` + `Seller.listings` back-relations.
- `prisma/backfill-listings.ts` — idempotent upsert script. Run on the VPS
  once after `prisma db push` to seed one listing per product.

After Step 1: `SELECT COUNT(*) FROM "ProductListing"` equals
`SELECT COUNT(*) FROM "Product"` and every existing flow is unchanged.

## Step 2 preview (next session)

```ts
// New module: services/api/src/modules/buybox
class BuyBoxService {
  async winnerFor(productId: string, buyerRegion?: string): Promise<ProductListing | null>
}
// GET /buybox/:productId → { listingId, sellerId, priceMinor, currency, condition,
//                            fulfillmentMode, inStock, deliveryEstimate }
// PDP uses this for the "Add to cart" CTA target; falls back to legacy
// Product.basePriceMinor only if /buybox 404s.
```

## Open questions for later

- **Price floor / MAP enforcement** when multiple sellers compete?
- **Per-warehouse vs per-listing inventory** — Phase 13 keys stock to
  variant + warehouse; the cleanest evolution is variant → listing →
  warehouse stock rows.
- **Repricer**: in-platform repricer service vs leaving sellers to use
  third-party tools via API?
