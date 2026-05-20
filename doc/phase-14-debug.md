# Phase 14 — Debug Pass

Companion to `phase-14.md`. Lists non-obvious decisions made during the
build, plus call-outs that a reviewer (or future-me) should know about
before changing this area.

## 1. Top architectural choices that landed

### 1.1 RefurbUnit ↔ ProductVariant link
We added `RefurbUnit.variantId @unique` rather than the reverse field on
ProductVariant. Reason: every refurb publish creates exactly one synthetic
variant, so the FK belongs on the row that's always present. The variant
carries `attributes.refurbUnitId` as a hint for downstream consumers that
only know about variants (cart UI, ledger).

A refurb product never has more than one variant per unit and never has
pooled inventory, so we don't need a discriminator field on Product — the
existing `condition` enum already segregates the two paths.

### 1.2 RefurbUnit defaults to QUARANTINED on create
Per Phase 14 spec section 4.4, no stock can go live without an
authenticity check. `RefurbUnitsService.create()` therefore writes
`availability = QUARANTINED` and `variant.inventoryQty = 1` only *after*
`AuthenticityService.create({outcome: PASS})` fires. This is the single
chokepoint — there is no admin override path in the controller surface.

### 1.3 InboundService.receive no longer bumps stock
Phase 13 wrote `stock.receiveInbound` from inside `receive()`. We removed
that call. Stock release now flows exclusively through
`AuthenticityService.create(PASS)`. Trade-off: a warehouse that bypasses
the auth-check UI cannot ship anything — which is the entire point. The
existing `InboundShipmentItem.receivedQty` field is still populated so
discrepancy reports work unchanged.

### 1.4 Atomicity for refurb checkout
Two buyers cannot race for the same physical refurb unit because
`markSoldInTx` runs `updateMany` with `availability IN (RESERVED-by-this-cart,
AVAILABLE)`. Prisma compiles that to one SQL UPDATE; the returned row
count is the truth. We pre-resolve the `OrderItem.id` via `newId()` so the
RefurbUnit's `soldOrderItemId` can be filled inside the same transaction
without a round-trip.

### 1.5 Warranty refund routes to wallet credit
`creditFromWarranty` issues store credit instead of calling the payment
processor refund path. Reasons: aged orders frequently have refund holds
the processor will reject; wallet credit is instant and reuses the
existing buyer flow; ops can mix wallet credit + free replacement without
double-paying. The `warranty.seller-defect` event still fires so seller
health takes the hit.

### 1.6 SellerCertification expiry recheck
`listActiveForSeller` lazily marks expired rows as EXPIRED on read. We
chose lazy over a scheduler because:
1. The publish gate is the only hot consumer.
2. A scheduler would be one more moving part to alarm on.
3. The lazy update is an idempotent UPDATE with a status predicate; safe
   under concurrent reads.

### 1.7 Brand authorization gate is per (seller, brand, categorySlug)
We do NOT explode to per-SKU rows. Real brand-auth agreements live at the
category level. A composite unique constraint
`@@unique([sellerId, brandId, categorySlug])` lets upsert handle renewals.

### 1.8 Topbar branding shifted
The buyer topbar tag changed from "Marketplace" to "Certified" to match
the positioning. Nothing else in i18n / SEO has been touched yet — that
sweep is intentionally deferred so the positioning copy can ship as a
single content review.

## 2. Things the reviewer should test

- Apply for `AUTHORIZED_RESELLER` → admin approves → seller can publish
  a NEW_GENUINE product. Without the cert, publish returns 403.
- Apply for `CERTIFIED_REFURBISHER` → admin approves → seller can create
  RefurbUnits via `/seller/refurb-units`. Without the cert, 403.
- Create a brand → authorize seller X for (brand, category) until
  2027-01-01 → seller publishes a NEW_GENUINE product in that category
  with `brandId` set → 200. Try a different brand → 400 "not authorized".
- Receive an inbound shipment for a NEW_GENUINE variant: confirm stock
  does NOT increase yet. Then POST `/warehouse/authenticity/checks` with
  `outcome=PASS` for that `inboundItemId` → stock now reflects the
  receivedQty.
- Create a RefurbUnit → confirm `availability=QUARANTINED`. POST a PASS
  check with `refurbUnitId` → availability flips AVAILABLE and the
  synthetic variant's `inventoryQty` becomes 1.
- Two buyers simultaneously checking out the same RefurbUnit: the loser
  must see ConflictException ("Refurb unit was sold to another buyer")
  and inventory rolls back cleanly.
- File a warranty claim from `/account/warranty` → admin resolves as
  RESOLVED_REFUND → buyer's wallet shows the credit; `warranty.seller-defect`
  event reaches the seller-health listener.
- Buyer hits `/verify` with a known serial → sees product, condition,
  authentication trail.

## 3. Known limitations / explicit non-goals

- Manufacturer warranty registry sync is out of scope (Phase 14 spec
  section 3). We surface terms only.
- Brand publish gate doesn't trigger on `PATCH` (no product-edit
  endpoint changes brand/category in the current code). When that
  endpoint lands, it must call `assertCanPublishNewGenuine` too.
- The seller's RefurbUnit creator UI uses raw productId + media ID
  inputs — a friendlier picker can land in Phase 15 alongside the
  trade-in flow that creates these in bulk.
- `WarrantyService.file()` falls back to `order.createdAt` for the
  window start when no delivery date is set. Slightly favours buyer;
  acceptable trade-off for now.

## 4. Files added

- `services/api/src/modules/brands/{brands.service,brands.controller,brands.module,dto}.ts`
- `services/api/src/modules/seller-certifications/{seller-certifications.service,seller-certifications.controller,seller-certifications.module,dto}.ts`
- `services/api/src/modules/refurb-units/{refurb-units.service,refurb-units.controller,refurb-units.module,dto}.ts`
- `services/api/src/modules/authenticity/{authenticity.service,authenticity.controller,authenticity.module,dto}.ts`
- `services/api/src/modules/warranty/{warranty.service,warranty.controller,warranty.module,dto}.ts`
- `packages/api-client/src/endpoints/{brands,certifications,refurb-units,authenticity,warranty}.ts`
- `apps/admin-web/src/app/{brands,certifications,authenticity,warranty}/page.tsx`
- `apps/seller-web/src/app/{certifications,refurb-units}/page.tsx`
- `apps/buyer-web/src/components/{TrustBadge,RefurbUnitPicker}.tsx`
- `apps/buyer-web/src/app/verify/page.tsx`
- `apps/buyer-web/src/app/account/warranty/page.tsx`

## 5. Files edited

- `services/api/prisma/schema.prisma` — added `RefurbUnit.variantId`
  field + unique. Earlier session added all Phase 14 models / enums.
- `services/api/src/app.module.ts` — registered five new modules.
- `services/api/src/modules/seller/{seller.service,dto}.ts` — publish
  gate now checks condition, brand-auth, and certifications.
- `services/api/src/modules/orders/orders.service.ts` — checkout
  atomically marks RefurbUnits SOLD inside the order transaction.
- `services/api/src/modules/fulfillment/inbound.service.ts` — `receive()`
  no longer bumps stock; that now flows only through auth-check PASS.
- `services/api/src/modules/catalog/catalog.service.ts` — surface
  `condition` and `brand` on the public product DTO.
- `services/api/src/modules/wallet/wallet.service.ts` — added
  `creditFromWarranty`.
- `packages/api-client/src/index.ts` — new endpoint re-exports.
- `packages/shared-types/src/dto/catalog.ts` — added `ProductCondition`,
  `BrandSummaryDto`, `condition`/`brand` on summary + detail.
- `apps/{admin,seller,buyer}-web/src/lib/api.ts` — wired new APIs.
- `apps/admin-web/src/components/Shell.tsx`, `apps/seller-web/src/components/Shell.tsx`,
  `apps/buyer-web/src/components/TopBar.tsx` — nav updates.

## 6. Build / type checks not run

The environment has no Node/TS toolchain. Before merging, run:

```
pnpm -r build
pnpm prisma migrate dev --name phase_14_authenticity_certified
pnpm -r typecheck
```

The Prisma migration should be examined for the
`@@unique([productId, serialNumber])` and `RefurbUnit.variantId @unique`
constraints — those are the atomicity-critical ones.
