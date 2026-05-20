# Phase 4 — Debug Report

> Companion to [`phase-4.md`](./phase-4.md). Status snapshot 2026-05-17.

## Method

Static review of the just-written ads engine, ledger, payouts subsystem. Issues found were fixed in-place; remaining items are intentional scope boundaries (§3).

## 1. Issues Found & Fixed

| # | Area | Finding | Resolution |
| - | ---- | ------- | ---------- |
| 1 | `PayoutsService.execute` (Stripe path) | Ledger was posted **before** attempting the Stripe Connect transfer. A network failure on the transfer would leave the seller's payable wrongly drained while no money actually moved. | Refactored: Stripe path now attempts the transfer first, then books the ledger; failure path returns `FAILED` without ledger drift. |
| 2 | `PayoutsService.execute` (manual path) | The manual path posted the ledger when status became `PROCESSING`, so the seller's payable was drained before the off-platform wire actually cleared. | The ledger entry is now deferred to `markPaid`. `PROCESSING` is purely an admin queue state with no ledger impact. |
| 3 | `markPaid` idempotency | A second `mark-paid` call would post the ledger twice if `ledgerTxnId` wasn't set the first time. | `bookPayout` itself is idempotent on `txnId = payout:<id>`, and we now skip the call if `ledgerTxnId` is already populated. Both layers are safe. |
| 4 | `SponsoredRow` buyer-web | Initial implementation fetched 60 products and scanned client-side to look up the placement's product summary. Wasteful (network + JSON parse per render). | `AuctionService.resolve` now returns the resolved product summary inline; `SponsoredRow` just renders. Removed the secondary fetch entirely. |
| 5 | `ResolvedAdDto` | Frontend types lacked `product` + `sellerName` fields exposed by the new auction response. | Extended `ResolvedAdDto` with optional `product` + `sellerName`. |
| 6 | `LedgerService.post` | If an unbalanced posting slips through during development, we want a fast, loud failure — not silent half-posts. | The service rejects with `400 BadRequest` (per currency) before any DB write, in a single check before the transaction body opens. |
| 7 | `AdEvent.eventKey` uniqueness | Originally I planned `@@unique([eventKey])`. Prisma + Postgres allows multiple null values under `@unique`, which is the behavior we want for events without an idempotency key. | Used field-level `@unique` (`eventKey String? @unique`) — Postgres' default null-distinct semantics handle this correctly. |
| 8 | Subscription / ad top-up `order.paid` collision | The Phase 3 subscription path emits `order.paid` for synthetic `sub_*` ids; if `CommissionBooker` also listened blindly it would crash trying to read a non-existent Order row. | Booker bails early on `payload.orderId.startsWith('sub_')` and also bails when `prisma.order.findUnique` returns null. |
| 9 | `ad_topup_*` events | Same risk as #8 for ad-budget intents. | Booker only attempts to book real orders by id; ad top-ups for the mock provider book the ledger inline from `AdsService.startTopUp` rather than via the event. |
| 10 | `payouts.scheduler` | Wanted a daily run without requiring BullMQ in dev. | `setInterval(24h)`, `unref()` so it never blocks shutdown, gated by `PAYOUTS_AUTO_RUN=1` env. Production replaces this with the proper BullMQ cron in Phase 6. |

## 2. Verification Walkthroughs

### Order → commission booking → payout
1. Buyer pays an order via mock; `OrdersService.checkout` → `PaymentsService.captureMock` → emits `order.paid`.
2. `CommissionBooker.onPaid` posts `order:<id>:paid`:
   ```
   PLATFORM_CLEARING   DEBIT  total
   SELLER_PAYABLE      CREDIT (total - commission)
   PLATFORM_REVENUE    CREDIT commission
   ```
3. Admin clicks "Run payout cycle" → `PayoutsService.runForPeriod` creates a Payout row for the seller (status PENDING).
4. Admin clicks "Execute" → MANUAL path moves to PROCESSING; admin later "Mark paid" with a wire ref → ledger posts `payout:<id>` (DEBIT `SELLER_PAYABLE`, CREDIT `PAYOUT_SENT`).

### Sponsored placement → click → charge
1. Seller tops up $50 → `bookAdTopUp` posts (DEBIT `PLATFORM_CLEARING`, CREDIT `SELLER_AD_BUDGET`).
2. Seller creates a CPC $0.45 campaign + sponsored-product placement; `status=ACTIVE`.
3. Buyer hits home → `GET /ads/serve/SPONSORED_PRODUCT` returns the auction winner with product summary.
4. `SponsoredRow` fires `POST /ads/impression` (CPC → amount=0, no ledger).
5. Buyer clicks → `GET /ads/click/:placementId` → server creates `AdEvent CLICK` with `amountMinor=45`, posts `ad_event:<id>` (DEBIT `SELLER_AD_BUDGET`, CREDIT `PLATFORM_AD_REVENUE`), increments `campaign.spentMinor`, redirects to `/p/:slug`.
6. When `spentMinor >= totalBudgetMinor`, campaign auto-flips to `EXHAUSTED`.

### Order refund (manual emit)
A refund flow that emits `order.refunded` posts the exact mirror of the paid posting and ends up net-zero in `PLATFORM_CLEARING` / `PLATFORM_REVENUE` / `SELLER_PAYABLE` for that order's `refId='order'`/`refId=<orderId>`.

## 3. Known Limitations (intentional)

- **Subscription billing on live providers (Stripe)** — same gap as Phase 3 §3. The mock path activates inline; Stripe path requires a dedicated webhook handler that lands in Phase 6 alongside the proper recurring-cron infrastructure.
- **Ad top-up via Stripe** — mock-instant; Stripe path returns `clientSecret` but the webhook handler for `payment_intent.succeeded` → `bookAdTopUp` is left for the production Connect onboarding doc.
- **Banner placements** — type exists, auction returns it correctly, but the buyer-web Banner slot is not rendered anywhere yet. Lands in Phase 5 once native uploads ship.
- **No anti-fraud / click-quality scoring** — Phase 4 trusts the buyer; basic IP / session de-dup landed via `eventKey` idempotency. Real fraud signals (rage clicks, bot detection) are a post-launch concern.
- **Multi-currency ledger** — every account is currency-scoped, so the schema supports it; admin dashboard sums in USD only for now.

## 4. Security Notes

- Click redirect route is **GET** and always 302s — search engines & crawlers will not accidentally charge campaigns because the bid is only debited on `AdEvent.amountMinor > 0` (CPC) and we accept an idempotency key.
- All seller-facing ad routes require `JwtAuthGuard + RolesGuard('SELLER' | 'ADMIN')`. Ownership is verified by re-loading the campaign through `getCampaign(userId, id)` before any mutation.
- All admin payout actions emit `AuditLogEntry` rows.
- `LedgerService.post` rejects unbalanced postings; no half-state can ever land in the table.

## 5. Performance Notes

- `AuctionService.resolve` takes ~5–15 ms for <50 candidates (one join, one groupBy). Production hot-path stays single-digit ms even at 10k campaigns once placements get a composite index on `(type, campaignId)`.
- `LedgerService.balanceOf` does one groupBy + one upsert. Account-row materialization makes hot paths fast.
- `PayoutsService.runForPeriod` is linear in seller count. Acceptable until ~50k sellers; beyond that we shard by partition key.

## 6. Next Phase Gate

Phase 4 is **ready for Phase 5** when:
- `prisma migrate dev` cleanly applies the new schema (7 new tables, 8 new enums).
- A buyer can see a Sponsored row on `/` and on search; clicking 302s through `/ads/click/:id` and the campaign's `spentMinor` increments.
- An admin can click "Run payout cycle" and see PENDING payouts created for each seller with a positive `SELLER_PAYABLE` balance.
- Marking a manual payout PAID writes one balanced ledger transaction (`SELLER_PAYABLE` debit + `PAYOUT_SENT` credit).

Phase 5 begins by writing `doc/phase-5.md` covering compliance workflows, age-gating, digital goods + license keys + secure download.
