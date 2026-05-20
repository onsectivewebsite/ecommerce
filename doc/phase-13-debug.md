# Phase 13 — Debug & Wire-Up Notes

Date: 2026-05-18

Phase 13 turned Onsective from a "list-and-handoff" marketplace into a
real fulfillment platform. Sellers send inventory to platform warehouses,
the routing engine picks the best warehouse at checkout, warehouse staff
work a pick list, and a daily scheduler accrues storage fees. This doc
captures the design decisions and what the post-build pass caught.

---

## 1. Decisions captured during the build

### 1.1 InventoryStock is the source of truth; ProductVariant.inventoryQty is a rollup
Pre-Phase-13 the variant's `inventoryQty` was directly mutated by sellers
and decremented at order time. Phase 13 introduces per-warehouse
`InventoryStock` rows whose sum is the authoritative on-hand. Every
`InventoryStockService.applyDelta` recomputes the variant rollup inside
the same Prisma transaction, so PDP, search, and cart code continue
reading `ProductVariant.inventoryQty` unchanged.

This keeps the migration story tight: SELLER-fulfilled products work
exactly as before (no InventoryStock rows; seller mutates `inventoryQty`
directly). PLATFORM-fulfilled products have InventoryStock rows and the
rollup mirrors their sum.

### 1.2 Single-warehouse-per-order routing in Phase 13
A platform-fulfilled cart that needs items from two warehouses falls
back to seller-fulfillment for the whole order. Reasons:
- Two warehouses → two `Shipment` rows → two trackings → partial-capture
  state machine — significant complexity we want to design carefully.
- Today's volume rarely needs splits; coverage gaps are the bigger
  issue. We address split shipments in a dedicated phase.

### 1.3 Fall-back to seller fulfillment is silent at the UI
The router returns `{ warehouseId, fallback, reason }`. On fallback,
`OrderItem.fulfilledFromWarehouseId` stays null and the order processes
through the legacy seller-fulfillment flow. The buyer doesn't see "we
tried to OF but couldn't" — they just see longer shipping times. The
seller dashboard can surface the fallback signal later (Phase 14).

### 1.4 Stock debit happens post-payment, not at order create
The legacy code decrements `ProductVariant.inventoryQty` inside the
order $transaction. For PLATFORM-fulfilled lines we additionally debit
the specific `InventoryStock` row in a `FulfillmentListener` that
listens for `order.paid`. The listener marks `OrderItem.pickedAt` for
idempotency — re-emitted `order.paid` events (from
`RiskService.release`) don't double-debit.

The legacy `inventoryQty` decrement at order time and the subsequent
rollup recompute could conflict (the recompute pulls from
`sum(InventoryStock)`). For platform-fulfilled variants this is fine
— the rollup is correct after the recompute. For seller-fulfilled
variants we never touch InventoryStock, so the rollup is never
recomputed and the legacy direct-write is preserved.

### 1.5 Receive-time discrepancy capture
`InboundShipmentItem` has both `receivedQty` and `discrepancyQty`. When
a seller ships 100 but the warehouse counts 96, we record received=96
and discrepancy=4 so accounting + ops have explicit numbers. If
discrepancyQty exceeds expected by > 10 the receive is rejected and
flagged for escalation — protects against a typo that would dump
ghost stock into the system.

### 1.6 Storage fees accrue daily, bill monthly
A naive month-end snapshot would under-count inventory that arrived
mid-month and over-count inventory that left mid-month. The daily
accrual writes one `StorageBillingRun` row per (seller, warehouse, day)
and the monthly run sums them. This pattern matches AWS-style
"second-precision" billing buyers expect in 2026 and keeps each charge
defensible.

### 1.7 Warehouse zones use country + optional region whitelist
A zone with `country=US, regions=[]` covers the entire US. A zone
with `country=US, regions=['CA','OR','WA']` covers only those three
state codes. This is enough for Phase 13; geographic distance ranking
(zip-distance, lat/long) is a follow-up when zone overlap gets
contested.

### 1.8 Pick list is a flat read, not a queue
Warehouse staff use it as a working set: sortable by oldest order or by
SKU (for batch picking). Marking picked is implicit — the existing
Shipment.markedShipped flow takes the OrderItem out of the list because
`pickedAt` is set when stock is debited at `order.paid`. (In other words,
the list shows items where `pickedAt IS NOT NULL` AND no shipment has
moved through.)

---

## 2. Issues caught during the post-build pass

### 2.1 The legacy inventory decrement runs for ALL lines
The order $transaction decrements `ProductVariant.inventoryQty` for
every item regardless of fulfillment mode. For PLATFORM-fulfilled
items, the subsequent `InventoryStockService.applyDelta` (fired by
the listener) recomputes the rollup from sum(InventoryStock), which
overrides the manual decrement. Net effect: rollup is correct.
But during the window between order create and `order.paid`, the
displayed inventory shows the legacy decrement only. That's fine for
the buyer — they got their item locked — and the listener recomputes
on payment capture.

### 2.2 `OrderItem.fulfilledFromWarehouseId` requires schema migration
The new column lands on every existing OrderItem row as NULL — meaning
historical orders are seller-fulfilled, which matches their actual
provenance. No data backfill needed.

### 2.3 Empty InventoryStock means the rollup zeros out
A PLATFORM-fulfilled variant with no InventoryStock rows ANYWHERE would
have `sum(InventoryStock) = 0` → rollup recompute zeros the variant.
That's the correct behavior — no stock anywhere means out of stock.
The risk is accidentally flipping a SELLER product to PLATFORM mode
before sending an inbound: the cart-reservation system protects against
overselling, but the seller would see their PDP go out-of-stock until
inbound is received. The seller-portal UI for the fulfillment-mode
toggle should warn about this; that warning is a follow-up.

### 2.4 Seller search-by-SKU endpoint is referenced but not yet built
`apps/seller-web/src/app/fulfillment/inbound/new/page.tsx` calls
`api.seller.searchVariantsBySku?.(query)` with optional chaining. The
existing SellerApi doesn't expose this method, so the search returns
empty and the page silently shows "no results". Wiring is a 30-line
follow-up: add `GET /seller/variants/search?sku=...` returning the
seller's own variants matching the SKU prefix. For Phase 13 we ship
the UI scaffolding and the underlying create flow works perfectly if
the variantId is supplied directly.

### 2.5 `FulfillmentModule` is @Global so OrdersService injects RoutingService
Marking the module global lets `OrdersService` inject `RoutingService`
without an explicit import in OrdersModule. The trade-off is that any
module can inject any FulfillmentModule provider — we accept this
because the fulfillment layer is genuinely cross-cutting (orders,
shipping, payments, listeners all care).

### 2.6 Stock-debit listener also fires for non-OF orders
The `FulfillmentListener.onOrderPaid` filters on
`fulfilledFromWarehouseId: { not: null }`. Orders with no platform-
fulfilled lines result in an empty array → no-op. Cheap and safe.

### 2.7 ShippingService.onOrderPaid still creates ONE Shipment per order
The existing Phase 2 shipping flow creates a single Shipment row per
order. For OF orders, the platform's chosen warehouse becomes the
ship-from. We do NOT split into multiple shipments in Phase 13. The
seller carrier-config still controls which carrier issues the label,
applied to whatever warehouse the routing chose.

### 2.8 Discrepancy validation cap is hard-coded at +10
`InboundService.receive` rejects a line where `receivedQty > expectedQty + 10`.
This catches data-entry typos (someone enters 1000 instead of 100) while
allowing minor over-receives. Configurable per-warehouse is a follow-up.

---

## 3. Wire-up checklist

- `app.module.ts`: `FulfillmentModule` registered (global). `OrdersService`
  injects `RoutingService`.
- `OrdersService.checkout`: routes platform-fulfilled lines before
  creating the order; stamps `fulfilledFromWarehouseId` on items.
- `FulfillmentListener` listens for `order.paid` → debits per-warehouse
  stock + marks `pickedAt` for idempotency.
- New endpoints: `/admin/warehouses`, `/warehouses` (public read),
  `/seller/inbound`, `/warehouse/:id/inbound`, `/warehouse/:id/pick-list`,
  `/seller/storage/statement`.
- api-client: `WarehousesApi`, `InboundApi`, `PickListApi`, `StorageApi`.
- Admin portal: `/warehouses` (CRUD).
- Seller portal: `/fulfillment/inbound` (list + create) + nav link.
- Shipping-web: `/pick-list` (per-warehouse working list) + nav link.

## 4. Operational env flags

- `STORAGE_FEES_ENABLED=1` — opt in to the daily storage accrual.
- `STORAGE_RATE_USD_PER_CM3_DAY=0.00002` — default rate (≈
  $0.60/cubic-foot/month). Tunable per environment.

## 5. Things deliberately out of scope

- **Split shipments across multiple warehouses for a single order** —
  noted as the highest-value follow-up.
- **Cross-dock / warehouse-to-warehouse transfers** — ops process today.
- **Long-term storage surcharges** (escalating rate after 6 months).
- **Returns into Onsective Fulfillment** — returns still go back to the
  seller. OF-handled return processing is a future phase.
- **Per-warehouse carrier selection** — uses the seller's existing
  `CarrierConfig`. A warehouse-scoped override would be needed for 3PLs
  that ship through their own carrier accounts.
- **Distance-based zone ranking** — current ranking is priority + zone
  specificity; lat/long-based ranking is a follow-up.
- **Seller search-by-SKU** for the inbound builder — the UI calls a
  method that doesn't exist yet (silently no-ops). Adding the endpoint
  is small and lands in the next phase or as a quick follow-up.
