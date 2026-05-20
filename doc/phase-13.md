# Phase 13 — Multi-Warehouse Fulfillment (Onsective Fulfillment)

Date opened: 2026-05-18
Predecessor: Phase 12 (Trust, Safety & Operations)

## 1. Why this phase

Today every order ships from the seller. Buyers see arbitrary delivery
windows (a US buyer ordering from a UK seller waits 7–14 days), sellers
hand-pack every package, and platform has no fulfillment leverage. The
biggest competitive moat in marketplace commerce — "buy today, arrive
tomorrow" — requires the platform to own (or partner-operate) the
warehouses.

Phase 13 ships **Onsective Fulfillment** (OF): sellers send inventory
to one or more platform warehouses, and we handle pick/pack/ship on
their behalf. Per-warehouse stock keeping, inbound receiving workflows,
zone-aware order routing, pick lists for warehouse staff, and monthly
storage billing all land in this phase.

Sellers don't have to opt in across the board — fulfillment is a
per-product setting (`fulfillmentMode = SELLER | PLATFORM`). A seller
can sell high-velocity SKUs through OF and self-fulfill long-tail SKUs
from their own warehouse.

## 2. Scope (in)

### 2.1 Warehouses + zones
- `Warehouse` row per platform-operated facility. `code` (`WHX-NJ-01`),
  `displayName`, address fields, optional `partnerCarrierAccountId`
  (when a 3PL operates it for us).
- `WarehouseZone` — coverage geometry expressed as `country` + optional
  `regions` array (US state codes, EU country codes). A warehouse can
  cover multiple zones. The router scans zones in order to pick a
  warehouse for an order.

### 2.2 Per-warehouse inventory
- `InventoryStock` row per (variantId, warehouseId).
  `quantityOnHand` is the unit-of-truth.
- `ProductVariant.inventoryQty` becomes a denormalized rollup of all
  `InventoryStock` rows for that variant. Every write to
  `InventoryStock` re-computes the rollup in the same transaction.
- The Phase 1 reservation system (Cart-scope holds) layers on top:
  reservations record `warehouseId` so a buyer's cart pre-decrements
  one warehouse, not the global rollup.

### 2.3 Inbound shipments
- Seller creates an `InboundShipment` to a chosen warehouse with line
  items (variant + qty). Status flow:
  - `DRAFT` — seller is composing.
  - `IN_TRANSIT` — seller has shipped; carrier tracking captured.
  - `RECEIVED` — warehouse staff has counted; stock bumped on the
    warehouse's `InventoryStock` rows.
  - `CLOSED` — terminal.
- Receiving an inbound atomically (a) writes `InventoryStock` deltas
  and (b) recomputes the variant rollup.
- Discrepancies (e.g., seller sent 100, received 96) are captured as
  per-line `receivedQty` so accounting is clean — the rest goes into
  a `discrepancyQty` for ops follow-up.

### 2.4 Fulfillment routing at checkout
- For each cart item whose product is `fulfillmentMode = PLATFORM`,
  the router picks the **best warehouse** that:
  1. Has stock ≥ qty for the variant.
  2. Covers the buyer's `shippingAddress.country` (+ region if zoned).
- Tie-break by zone specificity, then warehouse priority.
- The chosen `warehouseId` is persisted on `OrderItem.fulfilledFromWarehouseId`.
- For Phase 13 we **do not** split a single order across multiple
  warehouses — if a single warehouse can't satisfy the whole platform-
  fulfilled portion of the cart, the order falls back to the seller's
  own warehouse (with appropriate SHIPPING_DELAYED messaging).
- Seller-fulfilled items continue to use the existing Phase 2 flow
  (one Shipment per order using the seller's carrier).

### 2.5 Pick list for shipping-web
- New endpoint `GET /warehouses/:id/pick-list` returns the OrderItems
  pending pickup at that warehouse, grouped by order, with variant
  + bin location (free-form for now).
- shipping-web (existing portal) gets a `/pick-list` page where the
  operator selects their warehouse and works through the list.

### 2.6 Storage fees
- Daily scheduler computes per-seller storage volume × monthly rate.
- Per-variant `cubicCm` column captures volume; defaults to 1000 cm³ if
  unset.
- Stored cm³ × days held × rate per (cm³ · day). Default rate
  `0.00002 USD per cm³ per day` (≈ $0.60/cubic-foot/month).
- Monthly billing run writes a `ListingFeeCharge`-style row against the
  seller and surfaces in their next payout statement.

## 3. Scope (out)

- **Split shipments across multiple warehouses for a single order** —
  noted as a known follow-up. Phase 13 keeps the order-per-warehouse
  invariant to ship the rest of OF.
- **Cross-dock / overnight transfers between warehouses** — manual
  ops process today.
- **Long-term storage surcharges** — flat per-cm³ rate now;
  long-term escalation is a follow-up.
- **Returns into Onsective Fulfillment** — returns still go back to
  the seller (or destroyed per existing return-disposition flow).
  OF-handled return processing is a future phase.
- **Per-warehouse carrier selection** — the existing carrier abstraction
  applies; warehouse → carrier mapping uses the Phase 2 CarrierConfig.

## 4. Architectural decisions made up front

### 4.1 `InventoryStock` is the unit of truth, rollup is for reads
Writes go to `InventoryStock`. The same transaction recomputes
`ProductVariant.inventoryQty = sum(InventoryStock.quantityOnHand)`.
This keeps the existing PDP / cart / search code untouched — they
read `ProductVariant.inventoryQty` as before — while making the
per-warehouse view authoritative for ops.

### 4.2 Reservations carry `warehouseId`
A buyer's cart reservation on a PLATFORM-fulfilled variant locks
qty on a specific warehouse (the routing choice). If the cart is
abandoned, that warehouse's qty is released; no other warehouse's
qty was ever touched. This avoids the "released somewhere, double-
booked elsewhere" failure mode.

### 4.3 No split shipments in Phase 13
A platform-fulfilled cart that needs items from two warehouses
falls back to the seller's own fulfillment for the whole order
(with a slow-shipping notice). Splitting a single order across
two warehouses adds significant complexity (two Shipments, two
trackings, partial captures) that we want to design carefully
in a dedicated phase.

### 4.4 Storage cost is daily × rate, not month-end snapshot
A naive month-end snapshot under-counts inventory that arrived
mid-month and over-counts inventory that left mid-month. The daily
accrual gives a fair charge regardless of inbound/outbound timing
and tracks well against AWS-style "second-precision" billing models
that buyers are used to in 2026.

### 4.5 Pick list is a flat read, not a queue
Warehouse staff use the pick list as a working set, not a strict
queue. The endpoint sorts by (oldest order first, then SKU) so
operators can batch-pick by SKU when efficient. Marking an item
as picked is implicit — the existing Shipment.markedShipped flow
takes the OrderItem out of the list.

## 5. Acceptance criteria

- Admin can create a warehouse with two zones (e.g., US + CA).
- Seller can set a product to `PLATFORM` fulfillment and create an
  inbound shipment of 100 units to that warehouse.
- After the warehouse staff marks the inbound `RECEIVED` with
  `receivedQty: 100`, the variant's rollup shows 100 units and the
  per-warehouse view shows 100 at that warehouse.
- A buyer in the US placing an order for that variant gets the order
  routed to the US warehouse with `OrderItem.fulfilledFromWarehouseId`
  set; the shipping-web pick list for that warehouse includes the line.
- A buyer in Brazil (not covered by any zone) on the same SKU sees the
  fallback to seller-fulfillment.
- Daily storage scheduler computes a charge per seller and writes a
  monthly aggregate on the 1st of each month.
- `phase-13-debug.md` documents non-obvious choices + the debug pass.
