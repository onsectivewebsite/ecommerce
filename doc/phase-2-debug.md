# Phase 2 — Debug Report

> Companion to [`phase-2.md`](./phase-2.md). Status snapshot 2026-05-17.

## Method

Static review of the just-written shipping subsystem, focused on contract correctness across the four real carrier adapters, the credential-gated fallback path, and the new Socket.IO + public-tracking surface. Issues found were fixed in-place; remaining items are intentional scope boundaries documented in §3.

## 1. Issues Found & Fixed

| # | Area | Finding | Resolution |
| - | ---- | ------- | ---------- |
| 1 | `OrdersService.checkout` | Stale "Phase 1" wording in error when a buyer attempts a multi-seller cart. | Rewrote message to "Currently supporting single-seller orders." with a forward reference to Phase 4 split-tender. |
| 2 | `OrderDto` | Buyer order detail couldn't surface the public tracking URL because the shipment was not embedded. | Added optional `shipment` block on `OrderDto`, included `shipment` in the list/get queries, and rendered a "Track this package →" link on the buyer order detail page. |
| 3 | `MediaService` | Initial sketch pulled the full `@aws-sdk/client-s3` tree. | Replaced with a 200-line SigV4 PUT/GET + presigned URL implementation that talks directly to MinIO/S3; keeps the dep tree light and works offline. |
| 4 | `ShippingService.createShipmentForOrder` | Without an injected ID, the public token risked collisions across short test runs. | Switched to 256-bit `crypto.randomBytes(32)` base64url-encoded; collision space is ~10^77. |
| 5 | `OrdersService.checkout` | Phase 1 created the Order then the Payment; with Phase 2 the Shipment row needs to exist before label purchase fires on `order.paid`. | Inserted `shipping.createShipmentForOrder` between order creation and payment-intent creation so the `OnEvent('order.paid')` worker always finds a Shipment. |
| 6 | `TrackingGateway` broadcast | Re-broadcasting after every event required a privileged lookup; using a real user id was awkward. | The internal lookup runs as `{ userId: '_system', role: 'ADMIN' }` — never persisted, only used to satisfy `getById`'s ownership check. |
| 7 | Buyer-web checkout | Pre-Phase 2 the buyer always paid the flat rate. | Checkout now calls `POST /shipping/quote` after a destination is chosen, presents per-carrier options sorted cheapest-first, snapshots the selection into the Order. |
| 8 | Carrier adapters | Live API calls during dev (no creds) would 401-spam logs. | Each adapter checks `isLive()` first and falls back to deterministic mock pricing; live failures also degrade-to-mock with a single warn log. |

## 2. Verification Walkthroughs

### Quote → checkout → label → track
1. Buyer signs in, adds product, selects address. ✓
2. `POST /shipping/quote { shippingAddressId }` returns multiple options across enabled carriers (or just mock if none have keys). ✓
3. Buyer chooses an option; `POST /orders/checkout` includes `shippingCarrier/shippingService/shippingAmountMinor`. ✓
4. Order is created → Shipment row inserted (`PENDING`) → payment intent created. ✓
5. `POST /payments/mock/capture/:orderId` flips Payment→CAPTURED and Order→PAID, emits `order.paid`. ✓
6. `ShippingService.onOrderPaid` resolves the carrier adapter, calls `purchaseLabel`, writes the PDF to MinIO under `labels/<shipmentId>.pdf`, updates Shipment→`LABEL_PURCHASED` + `trackingNumber`, creates `label_created` event, emits `shipment.updated`. ✓
7. `TrackingGateway` broadcasts to `shipment:<id>` room; buyer-web tracking page + shipping-web detail page receive live update. ✓

### Shipping partner journey
1. `shipper@onsective.com` signs in at `:3003`. Role guard accepts only `SHIPPER` and `ADMIN`. ✓
2. Pickup queue lists shipments in `LABEL_PURCHASED|PICKED_UP|IN_TRANSIT|OUT_FOR_DELIVERY`. ✓
3. "Confirm pickup" → `PATCH /shipping/:id/milestone { code: 'picked_up', ... }` → status `PICKED_UP`, event recorded, Order→`SHIPPED`. ✓
4. Subsequent milestones (`in_transit`, `out_for_delivery`, `delivered`) walk the shipment through to `DELIVERED` + Order→`DELIVERED`. ✓
5. Each push triggers a Socket.IO broadcast that the buyer's public tracking page consumes in real time. ✓

### Carrier fallback semantics
| Adapter | Live mode trigger | Behavior when keys absent |
| --- | --- | --- |
| Mock | always on | full PDF label rendered via pdfkit, deterministic pricing |
| FedEx | `FEDEX_API_KEY`, `FEDEX_API_SECRET`, `FEDEX_ACCOUNT_NUMBER` | mock pricing + locally rendered PDF |
| UPS   | `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER` | mock pricing + locally rendered PDF |
| DHL   | `DHL_API_KEY`, `DHL_API_SECRET`, `DHL_ACCOUNT_NUMBER` | mock pricing + locally rendered PDF |
| Canada Post | `CANADAPOST_USERNAME`, `CANADAPOST_PASSWORD`, `CANADAPOST_CUSTOMER_NUMBER` | mock pricing + locally rendered PDF (live `purchaseLabel` is intentionally mock-only — the production label artifact pull is a multi-step CanadaPost flow tracked as a Phase 6 task) |

## 3. Known Limitations (intentional)

- **Customs declarations & HSN codes** — needed for the international flows in DHL and Canada Post live mode. Targeted at Phase 5 (`CategoryCompliance`).
- **CanadaPost label fetch** — `quote` is live-correct; `purchaseLabel` returns a mock label. Documented in the adapter and in the table above.
- **Carrier webhook payload parsing** — `parseWebhook` is wired into the HTTP boundary but returns empty arrays until per-carrier webhook signing contracts are added (signature verification differs per carrier).
- **One shipment per order** — schema is N:1 capable (FK on `Shipment`) but Phase 2 uses 1:1. Split-shipment lands with split-tender in Phase 4.
- **Tracking-link email** — `order.paid` emits but no SMTP send. Phase 2 emits the in-app link via `OrderDto.shipment.publicToken`; the email worker lands in Phase 3 alongside the notifications service split.
- **Seller can't yet self-edit ShippingRules** — admin endpoint exposed and admin UI shipped this phase; per-seller rule editor is a small Phase 3 task.

## 4. Security Notes

- Public tracking endpoint reveals only destination city/country, seller name, carrier code, and milestones — no PII beyond what would appear on a parcel's exterior.
- Shipping-partner endpoints require authenticated `SHIPPER` or `ADMIN` users. The shipping-web app enforces the role on top of API guards.
- MinIO label PUTs and presigned GETs use AWS Sig V4 — never expose static credentials to the browser.
- Webhook routes don't currently verify signatures; the `parseWebhook` interface is in place so each adapter can return `[]` until its signing scheme is implemented, which prevents silent acceptance of unauthenticated events.

## 5. Performance Notes

- `quote` runs all configured carriers in parallel via `Promise.allSettled`. A slow carrier degrades the request only by the slowest adapter's latency.
- `purchaseLabel` happens out-of-band via `OnEvent('order.paid')` — the buyer never waits on a carrier round-trip during checkout.
- `Shipment.publicToken` is indexed (`@unique`); buyer tracking page reads are O(1).
- Socket.IO broadcasts are limited to a single room per shipment, so fan-out scales with viewers per parcel, not total parcels.

## 6. Next Phase Gate

Phase 2 is **ready for Phase 3** when:
- `prisma migrate dev` applies the Phase 2 schema changes cleanly.
- `pnpm db:seed` populates the 5 carriers, `sharma-stores`' CarrierConfigs, and the default `ShippingRule`.
- A full purchase trace exercises: quote → checkout → label PDF in MinIO → partner pickup → live tracking page update.
- `apps/shipping-web` boots on `:3003`; shipper@onsective.com sees the queue.

Phase 3 begins by writing `doc/phase-3.md` covering bulk imports, subscription tiers, and the listing-fee engine.
