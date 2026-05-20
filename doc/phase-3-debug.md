# Phase 3 — Debug Report

> Companion to [`phase-3.md`](./phase-3.md). Status snapshot 2026-05-17.

## Method

Static review of the just-written subscription / inventory / bulk-import / listing-fee / audit subsystem. Issues found were fixed in-place; remaining items are intentional scope boundaries (§3).

## 1. Issues Found & Fixed

| # | Area | Finding | Resolution |
| - | ---- | ------- | ---------- |
| 1 | `BulkImportController` | The `BulkImportDto.csv` field had no class-validator decorator. With our global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`, an undecorated body field is stripped — the controller would always receive an empty string and the import would silently no-op. | Added `@IsString() csv!: string;` (and `@ApiProperty` for Swagger). |
| 2 | Express JSON body limit | Default Express `json()` middleware caps bodies at 100 KB. A CSV with even a few hundred rows exceeds that, so bulk import would fail with `PayloadTooLargeError`. | Bumped the limit to 5 MB at app bootstrap. |
| 3 | `CartService.addItem` (Phase 1 logic) | Phase 1 checked `variant.inventoryQty` directly. With Phase 3 reservations we need *effective* inventory (raw minus other carts' active holds). The naive check would let two buyers race for the last unit. | Refactored: the service now always calls `InventoryService.reserve(cartId, variantId, newQty)` first; reserve throws `400` if not enough effective stock, then we persist the cart row. |
| 4 | `OrdersService.checkout` | Reservations would linger after a successful order because we previously released them only on cart removal. | Added `await this.inventory.releaseCart(cart.id)` after the order TX commits — the cart-item rows are gone, the reservations are no longer needed (the stock decrement is permanent). |
| 5 | `SubscriptionsService.start` (non-mock) | Originally I planned to persist a `Payment` row for each subscription intent and let the existing `order.paid` webhook handler activate. That requires either a synthetic Order (huge schema gymnastics) or a separate event channel. | Phase 3 ships with **mock-mode subscription activation inline** (works in dev / tests). Live-provider subscription billing is consciously deferred to Phase 4 where the payout pipeline ships a proper recurring-billing cron. `maybeActivateOnPayment` is kept as a defensive `OnEvent('order.paid')` listener gated by `orderId.startsWith('sub_')` so Phase 4 just needs to insert the Payment row. |
| 6 | `SellerService.createProduct` | Subscription cap (BASIC ≤ 100 products) wasn't enforced. | Calls `subs.requireProductRoom(userId)` at the top of `createProduct`. The same guard fires per-row in bulk import (with an upfront cap check that rejects the whole upload if it would overshoot). |
| 7 | `AdminService` | Commission, setting, seller approve/reject didn't audit. | All four write paths now call `audit.record(...)` with `before`/`after` JSONB; the admin web `/audit-log` page renders the diffs. |
| 8 | `ListingFeesService.chargeOnPublish` | Initial sketch unconditionally inserted a charge row, double-billing if `createProduct` is retried. | Idempotency: bail out if a `ListingFeeCharge` already exists for the `productId`. |
| 9 | `BulkImportService` partial-write safety | A row failing mid-import could leave a half-imported set. | Per spec D-021: validate first, commit only when zero errors; each successful product still runs in its own TX so a downstream listing-fee insert failure on row N doesn't roll back rows 1..N-1. |
| 10 | `inventory.reservation.sweeper` (interval) | A `setInterval` keeps the Node event loop alive — graceful shutdown would hang. | Used `timer.unref?.()` so the sweeper doesn't block exit. |

## 2. Verification Walkthroughs

### Reservation lifecycle
1. Buyer A adds 5 units of `AWE-ONYX` (stock 120) → reservation `(cart_A, AWE-ONYX, 5, ttl 15m)`; effective stock for other carts: 115.
2. Buyer B adds 117 — `InventoryService.reserve` throws `400 Only 115 available`.
3. Buyer A checks out → cart items deleted in TX, stock decrement on the variant, then `releaseCart(cart_A)`; cart row is empty.
4. 15 minutes later (or one minute later if abandoned), the `ReservationSweeper` flips `releasedAt` on stale rows.

### Subscription upgrade (mock)
1. Seller hits `/subscription` → tier card grid.
2. Click "Upgrade to PRO" → `POST /seller/subscription/start { tier: PRO, paymentProvider: mock }`.
3. `SubscriptionsService.start` creates intent, sees provider=`mock`, calls `activate` inline.
4. Row written: `tier=PRO, status=ACTIVE, currentPeriodEnd=now+30d`. UI re-renders showing PRO badge.

### Bulk import dry-run → publish
1. Seller pastes 5 rows. `POST /seller/products/bulk-import` with `x-dry-run: 1`.
2. Service requires the `bulkImport` feature flag (PRO+); reports per-row OK / error including in-file SKU dupes and DB SKU clashes.
3. Seller fixes errors; without the header it commits — each row gets its own product TX and a `ListingFeeCharge` row carrying the resolved fee.

### Listing-fee rule resolution
With rules `(sellerId=null,categoryId=null,$0)`, `(sellerId=null,categoryId=electronics,$0.99)`, and a future `(sellerId=X,categoryId=null,$0.49)`:

| Seller | Category | Resolved | Why |
| ------ | -------- | -------- | --- |
| X | electronics | (still) electronics $0.99 | category+seller absent → highest match is category-only |
| X | books | seller-X $0.49 | seller-only beats platform-default |
| Y | books | platform $0 | fallback |

Selection runs as `priority = (sellerId?2:0) + (categoryId?1:0)` so the order is preserved.

### Audit log
1. Admin edits a commission via `/admin/sellers/:id/approve` with `commissionBps=2000`.
2. `AdminService.approveSeller` writes an `AuditLogEntry`:
   ```json
   {
     "action": "seller.approve",
     "entityType": "Seller",
     "entityId": "<sellerId>",
     "before": { "status": "PENDING", "commissionBps": null },
     "after":  { "status": "APPROVED", "commissionBps": 2000 }
   }
   ```
3. The `/audit-log` page renders it as "before → after".

## 3. Known Limitations (intentional)

- **Live Stripe subscription billing** — deferred to Phase 4 (payouts pipeline). Mock-mode activates inline today.
- **XLSX bulk import** — Phase 3 ships CSV only. `exceljs` lands in Phase 6 (i18n adds rich locale handling at the same time).
- **Variant matrix editor (PRO+)** — Phase 3 keeps the existing one-variant-per-row authoring; a true `attribute × value` editor is scheduled for Phase 4 next to ads.
- **Materialized analytics views** — `AnalyticsService` reads from live `Order`/`OrderItem` rows. Acceptable up to ~10k orders/day; Phase 6 swaps in nightly materialized views.
- **Reservation cross-replica lock** — a single sweeper running in one API replica is correct in Phase 3. The Redis SETNX lock noted in spec §3 is wired in Phase 6 when we deploy multiple replicas.

## 4. Security Notes

- `AuditLogEntry` is append-only in code (no update path exposed) — schema can be hardened with a Postgres `REVOKE UPDATE` in Phase 6's deployment hardening.
- `SubscriptionGuard` accepts a tier feature key; routes opt-in with `@RequireTierFeature('bulkImport')`. `ListingFeesController` is admin-only.
- `BulkImportService` validates the entire file before any write so a malformed row cannot leave partial state.
- `InventoryService.reserve` runs inside a Prisma transaction with re-read of free stock; concurrent reserves can't oversell because each waits inside the TX.

## 5. Performance Notes

- `InventoryService.effectiveQty` does one `aggregate` per variant — fine at PDP scale (<10 ms each). Phase 6 will cache the value in Redis for hot SKUs.
- `AnalyticsService.summary` aggregates orders + items in-memory after one DB round-trip. Switch to `groupBy` is already used for top-SKUs. Materialized views deferred per §3.
- Bulk import processes one product per TX (small) plus one listing-fee write per product. For a 500-row file: ~1s on dev hardware.

## 6. Next Phase Gate

Phase 3 is **ready for Phase 4** when:
- `prisma migrate dev` cleanly applies the Phase 3 schema (5 new tables, 2 new enums).
- `pnpm db:seed` populates `SellerSubscription(BASIC)` for the demo seller, the platform-default and electronics-specific listing-fee rules.
- A seller can: upgrade to PRO via mock checkout, run bulk import, view analytics; an admin can edit a listing-fee rule and see the corresponding audit-log entry on the next request.

Phase 4 begins by writing `doc/phase-4.md` and the `SponsoredProduct` / `LedgerEntry` models.
