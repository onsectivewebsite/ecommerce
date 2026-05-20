# Phase 21 — Multi-warehouse Smart Routing & SLA

Date opened: 2026-05-18
Predecessor: Phase 20 (Sustainability & Trade Reporting)

## 1. Why this phase

Phase 13's `RoutingService` picks a single warehouse for an entire
order. If no single warehouse stocks every PLATFORM-fulfilled line,
the whole order falls back to seller-fulfilled — even if 4 of 5 lines
could ship from a warehouse and only one needed a different source.
That's a regression on what platform fulfillment should deliver as
the network grows.

Phase 21:

1. **Per-item smart routing.** The router returns one
   warehouse per variant, not one warehouse for the whole order.
   Different lines can ship from different warehouses; no
   all-or-nothing fallback.
2. **SLA profiles.** Each warehouse declares its shipping +
   delivery windows per destination country (with optional
   region override). The router returns the profile alongside the
   pick so the order can snapshot a per-item promise.
3. **PDP "Get it by Y" line.** When a buyer has a default
   shipping address, the PDP fetches an estimate based on the
   best available warehouse and renders a delivery date.
4. **Breach tracking.** A scheduler scans for missed
   `promisedShipBy` and `promisedDeliverBy` timestamps, writes
   `SlaBreach` rows, and emits `sla.breach` events that
   downstream seller-health can read.

## 2. Scope (in)

### 2.1 WarehouseSlaProfile
- `WarehouseSlaProfile { id, warehouseId, country, region?,
  shipDays, deliveryDays, notes }`.
- Compound unique on `(warehouseId, country, region)` (region can be
  null for the country-default row).
- Admin CRUD from `/admin/sla`.
- Lookup priority: `(warehouseId, country, region)` →
  `(warehouseId, country, null)` → null.

### 2.2 Per-item routing
- New `RoutingService.chooseForOrderPerItem(input)` method that
  returns `Array<{ variantId, warehouseId | null, profile | null }>`.
- For each line: walk eligible warehouses (zone match + has stock)
  by ascending priority, return the first hit. Independent per
  line — different lines can pick different warehouses.
- Items with no eligible warehouse get `warehouseId = null` →
  treated as seller-fulfilled (legacy path), same as today.
- Phase 13's `chooseForOrder` stays as a wrapper that calls the new
  method and reduces to "are all items from a single warehouse" for
  back-compat with any caller that still expects that.

### 2.3 OrderItem snapshot fields
- `OrderItem.promisedShipBy DateTime?`
- `OrderItem.promisedDeliverBy DateTime?`
- `OrderItem.slaWindowDays Int?` (e.g., the deliveryDays the profile
  promised, for human display)
- Snapshotted at checkout. Updating a `WarehouseSlaProfile` later
  does not retroactively change promises.

### 2.4 SLA estimate for PDP
- `GET /sla/estimate?productId=...&country=...&region=...&qty=...`
  returns the most-promising warehouse's profile for that variant +
  the wall-clock shipBy / deliverBy.
- PDP renders "Get it by &lt;date&gt;" when the buyer has a default
  shipping address. No estimate is shown when the buyer is
  unauthenticated or has no address — we don't guess a country.

### 2.5 SLA breach detection
- `SlaBreachScheduler` (plain `setInterval` + env-gated, same
  pattern as Phase 12) runs every 10 minutes.
- Scans `OrderItem` rows where:
  - `promisedShipBy < now` AND `pickedAt IS NULL` AND no
    `SlaBreach(kind=SHIP)` exists → write SHIP breach, emit event.
  - `promisedDeliverBy < now` AND `order.shipment.deliveredAt IS
    NULL` AND no `SlaBreach(kind=DELIVER)` exists → write DELIVER
    breach, emit event.
- `sla.breach` event carries `{ orderItemId, kind, breachHours,
  sellerId }`. Phase 12 seller-health can subscribe in a follow-on.

### 2.6 Admin SLA dashboard
- `/admin/sla` shows profiles per warehouse, recent breaches,
  and a small histogram (count by kind per day).

## 3. Scope (out)

- Carrier-aware estimates (e.g., the chosen ShippingService carrier
  has its own committed transit days). We use the warehouse profile
  as the single source — future iteration can overlay carrier data.
- Cross-border SLA (no profile = no estimate; we don't make one up).
- Buyer-facing breach notifications. We record + emit; surfacing
  to the buyer is a future iteration since the existing notification
  system (Phase 12 already wraps notifications) needs a new template
  decision.
- Automatic re-routing when a warehouse becomes out of stock between
  checkout and pick. Phase 13's existing `FulfillmentListener` handles
  decrement failures; this phase doesn't add a re-router.

## 4. Architectural decisions made up front

### 4.1 Per-item routing instead of split-by-shipment
We pick a warehouse per line; we do NOT create multiple Shipment
rows per order. The existing `Order ↔ Shipment` 1:1 stays. Each line
just tags `fulfilledFromWarehouseId` independently. The carrier
abstraction (Phase 2) is ignorant of multi-warehouse and just labels
the order to the buyer's address — we accept the cost trade-off here
because the volume is dominated by single-warehouse orders.

### 4.2 SLA promise snapshotted on OrderItem
We snapshot at checkout. Editing the profile later doesn't retroactively
change anyone's promise. Same pattern as tax (Phase 6) and
sustainability (Phase 20).

### 4.3 Breach scheduler, not real-time
A scheduler is the right shape for "the moment a deadline passes" —
the alternative would be per-order timers, which don't survive
restarts and don't scale. 10-minute granularity is good enough for
SLA windows expressed in days. The poll is indexed by
`(promisedShipBy, pickedAt)` so it's cheap.

### 4.4 Region is just a free-form string
Same as the existing `WarehouseZone.regions` (US state codes, EU
country codes inside a region, postal-code prefixes — caller
decides). The profile lookup does an exact match on region; "fuzzy"
matching is out of scope.

### 4.5 No profile = no promise
If no `WarehouseSlaProfile` exists for the chosen warehouse +
destination, we still route the item but leave the promise fields
null. PDP shows nothing instead of guessing. Admin sees the missing
profile via a "missing profile" surface on `/admin/sla`.

### 4.6 Routing service signature kept additive
`chooseForOrderPerItem` is a new method on the existing service. The
old `chooseForOrder` becomes a thin wrapper: it now calls the new
method, picks the most common warehouse, and returns the previous
shape. Reduces ripple risk for any caller relying on the legacy
signature.

## 5. Acceptance criteria

- Admin sets SLA profiles for warehouse WH-NJ + country US:
  shipDays=1, deliveryDays=3.
- A 2-line order where both items have stock at WH-NJ:
  `OrderItem.fulfilledFromWarehouseId` = WH-NJ for both;
  `promisedShipBy = now + 1d`, `promisedDeliverBy = now + 3d`,
  `slaWindowDays = 3`.
- A 2-line order where line A has stock only at WH-NJ and line B
  only at WH-CA: line A routed to WH-NJ with its profile snapshot;
  line B routed to WH-CA with CA's profile (or null if no profile);
  shipment still single, single shipping label.
- A line with no eligible warehouse anywhere → seller-fulfilled
  legacy path, no promise fields set.
- PDP with a buyer's default US address → "Get it by &lt;date 3 days
  out&gt;" line rendered.
- Order item passes its `promisedShipBy` without `pickedAt` → next
  scheduler tick writes a `SlaBreach(kind=SHIP)` row and emits
  `sla.breach`. Re-running the scheduler doesn't double-write.
- Admin `/admin/sla` shows the breach in the recent list with the
  breach hours.
- `doc/phase-21-debug.md` captures decisions and limitations.
