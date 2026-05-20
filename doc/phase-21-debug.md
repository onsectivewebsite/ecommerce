# Phase 21 — Debug Pass

Companion to `phase-21.md`. Decisions made, seams to watch, what to
test before merging.

## 1. The invariants Phase 21 preserves

1. **Snapshotted promises.** `OrderItem.promisedShipBy /
   promisedDeliverBy / slaWindowDays` are written once at checkout
   and never recomputed. Editing a `WarehouseSlaProfile` later
   affects future orders only — same as tax (Phase 6) and
   sustainability (Phase 20).
2. **Idempotent breach writes.** `SlaBreach` is unique on
   `(orderItemId, kind)`. A re-run of the scheduler is a no-op.
3. **Sustainability of primary lifecycles.** The router still falls
   back to seller-fulfilled at the line level when no warehouse can
   cover it. The scheduler catches its own errors. SLA writes never
   block a checkout.

## 2. Non-obvious decisions

### 2.1 Per-item routing, single Shipment
We pick a warehouse per line; we do NOT split into multiple
shipments. The existing `Order ↔ Shipment` 1:1 stays. Each
`OrderItem` independently tags `fulfilledFromWarehouseId`. The
carrier label is still order-level — accepted cost trade-off,
since the dominant case is single-warehouse fulfillment.

### 2.2 Old `chooseForOrder` left untouched
Phase 13's `chooseForOrder` is no longer called by `OrdersService`
but is left in place because (a) other code paths may depend on it
later, (b) Phase 21's `chooseForOrderPerItem` is a complete
superset. No need to actively remove.

### 2.3 PDP estimate uses bulk variant-by-variant routing
`SlaService.estimateForBuyer` loops over the product's first 5
variants and runs `chooseForOrderPerItem` for each as a single-line
request. Brute-force is fine because this is a PDP-level call with
small N and is happy-path cached at the HTTP layer by the SSR
fetcher. If product detail pages start serving thousands of
variants, switch to a bulk-stock query.

### 2.4 Region is exact-match
`(country, region)` is exact-match against the stored profile.
Caller normalizes region to uppercase. There is no fuzzy matching
("CA" doesn't match "California"); the convention is callers send
the same shape the profile was registered with — typically ISO
country code + US-style state code.

### 2.5 Scheduler interval = 10 minutes
SLA windows are expressed in days, so 10 minutes is generous
enough granularity. The `OrderItem.promisedShipBy + pickedAt`
filter is indexed, so the scan cost is bounded.

### 2.6 Per-row event emission after scan
The scheduler walks recently-written `SlaBreach` rows and emits one
`sla.breach` event per row. Listeners (e.g., future seller-health
input) can subscribe. We deliberately don't fire the events from
inside `scanBreaches()` — keeping the service pure makes
`POST /admin/sla/scan` callable on-demand without producing
duplicate events from the per-row emission path.

### 2.7 Estimate hides itself when info is missing
`SlaPromise` renders nothing when:
- buyer is signed out
- buyer has no default address
- estimate has no `deliverBy` (no profile for the chosen warehouse)

Better than guessing. Country mismatches are silently skipped.

### 2.8 `WarehouseSlaProfile.warehouseId` cascade-deletes
Profiles are tied to a warehouse — when a warehouse is removed,
its profiles go too. `SlaBreach` rows cascade-delete with their
OrderItem, but the OrderItem itself cascades from Order, so the
breach history dies with the order. Acceptable; aggregate metrics
should be derived eagerly elsewhere if you want them to outlive
order deletion.

## 3. Things to test end-to-end

- Admin creates SLA profile (WH-NJ, US, ship=1, deliver=3).
- Buyer with a default US address opens a PDP for a PLATFORM-mode
  product → "Get it by &lt;date+3d&gt;" line appears.
- Buyer with no default address → no promise line shown.
- Two-line order both at WH-NJ → both items
  `fulfilledFromWarehouseId=WH-NJ`, both with snapshotted promises.
- Two-line order where line A stocks only at WH-NJ and line B only
  at WH-CA → A→WH-NJ, B→WH-CA, each with its own promise (or null
  if no WH-CA profile exists).
- Line with no warehouse anywhere → seller-fulfilled (null
  warehouseId), no promise fields set.
- `POST /admin/sla/scan` after letting `promisedShipBy` pass with
  `pickedAt=null` → SHIP breach row written, `sla.breach` event
  fired. Re-run → no duplicate.
- Mark item picked → next scan does NOT write another SHIP breach.
- Pass `promisedDeliverBy` without shipment delivered → DELIVER
  breach row written.

## 4. Known limitations

- No carrier-side overlay on the estimate. We use only the
  warehouse profile.
- No buyer-facing breach notifications. Phase 12 notifications are
  available but require a new template choice — deferred.
- No automatic re-routing if a chosen warehouse goes out of stock
  between checkout and pick. The Phase 13 listener still handles
  decrement failures.
- No seller-health input wiring. The `sla.breach` event is emitted
  but the existing `SellerHealthService` doesn't aggregate it yet
  (it pulls from DB tables at snapshot time, not from events).
  Captured as follow-up.
- Admin profile editor uses a flat form (no warehouse picker
  dropdown).

## 5. Files added

- `services/api/src/modules/sla/{sla.service,sla-breach.scheduler,sla.controller,sla.module,dto}.ts`
- `packages/api-client/src/endpoints/sla.ts`
- `apps/buyer-web/src/components/SlaPromise.tsx`
- `apps/admin-web/src/app/sla/page.tsx`

## 6. Files edited

- `services/api/prisma/schema.prisma` — added `SlaBreachKind` enum,
  `WarehouseSlaProfile` + `SlaBreach` models, OrderItem promise
  snapshot fields + indexes, Warehouse back-relation.
- `services/api/src/modules/fulfillment/routing.service.ts` — added
  `chooseForOrderPerItem` + `resolveSlaProfile` + per-item route
  result type.
- `services/api/src/modules/orders/orders.service.ts` — checkout
  now uses per-item routing; snapshots promise fields per
  OrderItem.
- `services/api/src/app.module.ts` — registered `SlaModule`.
- `packages/api-client/src/index.ts` — re-export `sla`.
- `apps/{admin,buyer}-web/src/lib/api.ts` — wired `SlaApi`.
- `apps/admin-web/src/components/Shell.tsx` — added SLA nav.
- `apps/buyer-web/src/components/ProductBuyBox.tsx` — added
  `SlaPromise` under the price.

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_21_sla
pnpm -r typecheck
pnpm -r build
```

To enable the breach scheduler in dev/prod:

```
SLA_SCHEDULER_ENABLED=1
```

The migration adds 3 new OrderItem nullable columns, two new tables
(`WarehouseSlaProfile`, `SlaBreach`), one new enum, and three new
indexes. No backfill needed — existing OrderItems keep `null`
promise fields, and the scan only inspects rows where the promise
is set.
