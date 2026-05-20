# Phase 14 — Authenticity & Certified Refurbished

Date opened: 2026-05-18
Predecessor: Phase 13 (Onsective Fulfillment)
**Positioning pivot:** Onsective is now certified-only retail. Open
marketplace and buyer-to-buyer trade are explicitly out of scope.

## 1. Why this phase

Onsective will not be a generic marketplace. Every listing on the platform
is either:

1. **Brand-new authenticated genuine** — sold by an authorized reseller of
   the brand, serial-verified at intake, manufacturer warranty applies.
2. **Certified refurbished** — sold by a certified refurbisher, per-unit
   serialized listing with documented condition grade and platform-backed
   warranty.

This phase ships the foundation: brand authorization, refurbisher
certification, per-unit refurb listings, mandatory inbound authenticity
checks, warranty tiers, and the buyer-facing trust UI that surfaces all
of it.

Drop-shipping is out of scope on principle — every sold unit must
physically pass through an Onsective warehouse or a verified seller's
own warehouse before it ships. This locks in the authenticity guarantee.

## 2. Scope (in)

### 2.1 Brands + brand authorization
- `Brand` table (admin-managed): name, slug, logo, verification
  contact, allowed categories.
- `BrandAuthorization` per (sellerId, brandId, categoryId, expiresAt).
  Brand can authorize a seller to sell brand X products in category Y
  until date Z.
- Product publish is gated: a NEW_GENUINE listing in a branded category
  fails publish if the seller doesn't have a valid authorization for
  that brand+category.
- Admin overrides for edge cases (e.g., genuine vintage stock that
  predates the authorization program), with audit-logged reason.

### 2.2 Seller certification
- `SellerCertification` per (sellerId, kind, expiresAt). Two kinds in
  Phase 14: `AUTHORIZED_RESELLER` and `CERTIFIED_REFURBISHER`.
- Sellers apply via `POST /seller/certifications`, upload supporting
  documents (insurance, R2/ISO certificate, brand letter), wait for
  admin approval.
- Refurbisher certification additionally requires:
  - At least one passing sample audit (admin records the audit result).
  - Facility address declared (warehouses Phase 13 maps onto this).
- Certification expiry: 12 months by default; renewal is a new
  application reviewing the same documents.
- Publish gate: a REFURB_GRADE_* listing requires `CERTIFIED_REFURBISHER`;
  a NEW_GENUINE listing requires either `AUTHORIZED_RESELLER` for the
  brand or admin-override.

### 2.3 Product condition + per-unit refurb listings
- `Product.condition` becomes a required enum: `NEW_GENUINE`,
  `REFURB_GRADE_A`, `REFURB_GRADE_B`, `REFURB_GRADE_C`.
- For NEW_GENUINE: existing pooled inventory model is unchanged. The
  variant has a quantity; any unit sold is interchangeable.
- For REFURB_GRADE_*: each physical unit becomes its own listing via
  the new `RefurbUnit` row. A RefurbUnit has:
  - `serialNumber` (required for electronics), `imei` (optional),
  - `conditionReport` JSON (battery health %, cosmetic notes,
    replaced parts list),
  - photo gallery (`mediaIds[]`) showing the actual unit,
  - `priceMinor` (unit-specific),
  - `availability` (AVAILABLE / RESERVED / SOLD / WITHDRAWN).
- Refurb units are listed as singleton variants — quantity is always 1.
- Buyer's cart can only contain one RefurbUnit per row; checkout marks
  the unit SOLD as part of the order transaction (atomicity matters —
  two buyers can't race for the same physical unit).

### 2.4 Mandatory inbound authenticity check
- Phase 13's `InboundService.receive` already records `receivedQty`.
  Phase 14 adds: every received unit must produce one
  `AuthenticityCheck` row before stock goes live.
- For NEW_GENUINE: serial scan against brand registry (where the brand
  provides one; otherwise hologram + box photo capture).
- For REFURB_GRADE_*: serial scan + full condition photo capture +
  QA inspector sign-off.
- A failed check pauses the unit (status = QUARANTINED) and routes to
  the admin investigation queue (Phase 12 risk/health surfaces this).
- Repeat failures hit the seller's `SellerHealthSnapshot` score and can
  auto-pause the seller.

### 2.5 Warranty tiers + claims
- Per-condition warranty:
  - `NEW_GENUINE` → manufacturer warranty (we surface terms; we don't fulfill).
  - `REFURB_GRADE_A` → 12 months platform-backed.
  - `REFURB_GRADE_B` → 6 months platform-backed.
  - `REFURB_GRADE_C` → 30 days platform-backed.
- `WarrantyClaim` is a separate flow from regular returns (Phase 9 returns
  are buyer-remorse; warranty claims are defect-driven). Claim opens with
  symptom description + photo, admin reviews, resolution paths:
  - Replace (route a new RefurbUnit of same grade or upgrade)
  - Repair (route to refurbisher for fix + reshipping)
  - Refund (use existing payments refund path)
- Warranty claims that resolve as Refund flag the seller's quality score
  (lower than a regular return because it indicates a missed defect).

### 2.6 Buyer trust UI
- PDP shows the condition badge prominently above the buy box:
  - "Certified Genuine · Authorized Reseller" (green)
  - "Certified Refurbished · Grade A" (gold), B (silver), C (bronze)
- Condition gallery for refurb: tab between standard product photos and
  "this unit" photos.
- Warranty terms inline near the price ("12-month platform warranty"
  with a learn-more link).
- Serial-number lookup link on every order item — buyer can verify
  authenticity by entering the serial; we show a green check + the
  authentication trail.
- Search-result cards get a small badge so buyers know which listings
  are refurb at-a-glance.

## 3. Scope (out)

- Trade-in flow (Phase 15).
- AI-assisted authentication / grading (Phase 16).
- Brand storefronts (Phase 17).
- Manufacturer warranty registry integration (we display terms but don't
  sync to manufacturer warranty systems in Phase 14).
- Buyer-side identity verification (already covered in Phase 5 for
  age-gated; not extending for high-value purchases in Phase 14).

## 4. Architectural decisions made up front

### 4.1 RefurbUnit is its own row, not a variant attribute
A REFURB_GRADE_* product has zero `ProductVariant` rows. Each physical
unit is a `RefurbUnit` row that the cart and order systems treat as a
singleton variant. Reasons:
- Per-unit photos + condition reports + serials don't fit cleanly on
  `ProductVariant` (which is sized for pooled inventory).
- Two buyers cannot race for the same physical unit — RefurbUnit has its
  own `availability` field guarded by a unique constraint at checkout.
- Refurbisher operations want unit-level lifecycle (received → graded →
  listed → sold → maybe-returned-as-warranty-claim → re-graded).

### 4.2 Cart + checkout treat RefurbUnit as a variant
We expose a synthetic variant view to the cart layer so cart UI code
doesn't need to learn about two product types. The order line carries
both `variantId` (legacy, optional for refurb) and `refurbUnitId`
(set for refurb lines). Checkout's reservation/decrement code branches
on which field is set.

### 4.3 Brand authorization is per (seller, brand, category)
A seller might be authorized to sell Apple iPhones but not Apple
laptops. Granularity at (brand, category) matches reality of brand
authorization agreements without exploding into per-SKU rows.

### 4.4 Authenticity check is mandatory, not optional
We do not let inbound stock go live without a check, ever. The trade-off
is slower warehouse throughput; the benefit is the certification
guarantee. Warehouse staff UI streamlines this (scan serial → camera
opens → submit; the whole check is <30s per unit).

### 4.5 Warranty claims live alongside returns, not inside them
A buyer can have both: a return (don't want it) and a warranty claim
(it broke). The two flows have different SLAs, different burden of
proof, different financial treatment. Keeping them as sibling tables
makes both reporting and ops queues cleaner.

### 4.6 Brand can be NULL on Product
Not every product has a brand (no-name commodities, white-label parts).
NULL brand means no brand-authorization gate runs — but a base seller
certification is still required, so we don't lose the certified-only
positioning.

## 5. Acceptance criteria

- Admin can create a brand "Acme" and authorize seller X to sell Acme
  in category "phones" until 2027-01-01.
- Seller without certification cannot publish any listing.
- Seller applies for CERTIFIED_REFURBISHER, admin approves, seller can
  now publish REFURB_GRADE_* listings.
- Seller publishes a REFURB_GRADE_A iPhone with serial, IMEI, condition
  report, and photo gallery. Listing shows up in search with the
  "Certified Refurbished · Grade A" badge.
- Seller creates an inbound shipment for that unit. Warehouse receives
  and runs an AuthenticityCheck (serial + photo + signoff). Unit becomes
  AVAILABLE.
- Buyer adds the unit to cart, checks out, the unit transitions to SOLD
  atomically (no double-sell possible).
- Buyer can later file a WarrantyClaim from `/account/orders/[id]`
  separately from a regular return.
- `phase-14-debug.md` captures non-obvious decisions + the debug findings.
