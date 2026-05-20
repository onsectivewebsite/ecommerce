# Phase 5 — Compliance & Regulated Products

> Status: 🟡 in progress · Owner: platform · Window: 2026-05-17 → 2026-05-17

Phase 5 turns Onsective into a marketplace that can legally sell **age-restricted**, **jurisdiction-restricted**, and **digital** goods. It introduces compliance rules attached to categories, a seller document-verification workflow, a buyer-side age gate with consent storage, secure digital-goods delivery (license keys + signed downloads), and the per-product HSN/tariff metadata that customs forms and label generators need.

## 1. Goals

1. **Per-category compliance rules** (admin-managed): minimum buyer age, ID-doc requirement for sellers, country allow/deny lists, jurisdiction notes.
2. **Seller doc verification** with admin review queue (approve / reject / expire).
3. **Buyer age gate** that records explicit consent (DOB + method + IP/UA + timestamp) before age-restricted items can be added or checked out.
4. **Country gate**: orders containing items blocked in the buyer's shipping country are rejected at checkout, not silently dropped.
5. **Digital goods**:
   - `LicenseKeyPool` per digital product — keys imported in bulk by the seller, drawn down atomically on order.paid.
   - `FILE_DOWNLOAD` mode — buyer gets a presigned MinIO URL scoped to their order item with TTL + download-count limit.
   - Delivery is automatic on `order.paid`; buyers see deliveries on `/account/downloads`.
6. **HSN / tariff codes** on every product. Surfaced on order details, shipment label PDFs, and the admin export.
7. **No physical-goods flow regression** — a regular product with no compliance attached and no digital config behaves exactly as in Phase 1–4.

## 2. Non-goals (intentional, deferred)

- **Third-party ID-verification providers** (Onfido, Veriff). Phase 5 ships self-declaration + uploaded ID image stored in MinIO for admin review. Real KYC integration is a Phase 6 onboarding deliverable.
- **DRM-protected video / streaming** — out of scope. `FILE_DOWNLOAD` ships static asset URLs only.
- **Per-jurisdiction sales-tax accrual** — covered by Phase 6's tax engine. Phase 5 only blocks/allows sales; it does not change tax calculations.
- **Per-seller insurance riders** — operations problem, not a platform feature.

## 3. Data model additions

```
enum ComplianceRequirementKind { AGE_GATE  ID_VERIFICATION  LICENSE_DOC  JURISDICTION_RESTRICTED  DIGITAL_LICENSE }
enum ComplianceDocStatus       { PENDING  APPROVED  REJECTED  EXPIRED }
enum DigitalGoodType           { LICENSE_KEY  FILE_DOWNLOAD }
enum LicenseKeyStatus          { AVAILABLE  ASSIGNED  REVOKED }
enum AgeConsentMethod          { SELF_DECLARATION  ID_VERIFIED  PAYMENT_GATEWAY }

model CategoryCompliance {
  id              String   @id
  categoryId      String   @unique
  minBuyerAge     Int?            // e.g. 18, 21 for alcohol/firearms
  requiresSellerDoc Boolean @default(false)
  requirementKinds  ComplianceRequirementKind[]
  blockedCountries  String[]      // ISO-3166-1 alpha-2
  allowedCountries  String[]      // empty = "all except blocked"
  notes           String?         // free-form admin guidance
}

model SellerComplianceDoc {
  id              String   @id
  sellerId        String
  categoryId      String?         // doc proves seller is licensed for this category
  docType         String          // e.g. "alcohol_license", "id_passport"
  fileObjectKey   String          // MinIO key
  fileSizeBytes   Int
  status          ComplianceDocStatus @default(PENDING)
  expiresAt       DateTime?
  reviewedByUserId String?
  reviewedAt      DateTime?
  rejectionReason String?
}

model DigitalProduct {
  id              String   @id
  productId       String   @unique
  type            DigitalGoodType
  fileObjectKey   String?         // for FILE_DOWNLOAD
  fileSizeBytes   Int?
  fileChecksum    String?         // sha256 for tamper detection
  downloadLimit   Int      @default(5)
  expiryDays      Int      @default(30)
  notesToBuyer    String?
}

model LicenseKey {
  id              String   @id
  digitalProductId String
  codeEncrypted   String          // AES-256-GCM ciphertext base64
  codeFingerprint String   @unique // sha256 to dedupe imports without revealing
  status          LicenseKeyStatus @default(AVAILABLE)
  assignedOrderItemId String?
  assignedAt      DateTime?
  revokedAt       DateTime?
}

model DigitalDelivery {
  id              String   @id
  orderItemId     String   @unique
  digitalProductId String
  licenseKeyId    String?         // when type=LICENSE_KEY
  downloadCount   Int      @default(0)
  expiresAt       DateTime
  deliveredAt     DateTime @default(now())
  lastDownloadAt  DateTime?
}

model AgeConsentEvent {
  id              String   @id
  userId          String?         // null for anonymous (with sessionId)
  sessionId       String?         // anonymous correlation id
  productId       String?
  categoryId      String?
  dob             DateTime
  declaredAge     Int
  method          AgeConsentMethod
  ipHash          String           // sha256(ip + salt); raw IP not stored
  userAgent       String?
  occurredAt      DateTime @default(now())
}

// Product additions:
//   hsnCode           String?
//   tariffCountry     String?       // origin for HSN — ISO-3166-1 alpha-2
//   isDigital         Boolean @default(false)
//   requiresAgeCheck  Boolean @default(false)   // mirror of category rule for fast read
//   minBuyerAge       Int?                       // per-product override (>= category)
```

## 4. Backend module layout

```
services/api/src/modules/compliance/
  compliance.module.ts
  category-rules.service.ts          # admin CRUD on CategoryCompliance
  seller-docs.service.ts             # upload, list, approve, reject
  age-consent.service.ts             # record + lookup latest valid consent
  admin-compliance.controller.ts     # /admin/compliance/*
  seller-compliance.controller.ts    # /seller/compliance/*
  buyer-compliance.controller.ts     # /compliance/* (public-ish: age consent submit, rules read)

services/api/src/modules/digital-goods/
  digital-goods.module.ts
  digital-goods.service.ts           # product config, license key import, signed-URL issuance
  delivery.service.ts                # creates DigitalDelivery on order.paid
  seller-digital.controller.ts       # /seller/digital/*
  buyer-downloads.controller.ts      # /downloads/* (GET signed URL, list mine)
```

### Compliance integration points

- **Catalog read** (`CatalogService.getProduct`) now joins `CategoryCompliance` and returns a `compliance` block on `ProductDetailDto` so the buyer-web can render age-gate + country warning before checkout.
- **Cart `add`** rejects with `412 PreconditionFailed` if product requires age check and the buyer has no valid `AgeConsentEvent`.
- **OrdersService.checkout** runs `ComplianceService.gateOrder(userId, cart, shippingAddress.country)`:
  - if any item is age-restricted and consent is missing/expired → `412`
  - if shipping country is blocked for any item → `403`
  - if any digital line has no available `LicenseKey` and type=LICENSE_KEY → `409 Conflict`
  - if seller has unapproved doc requirement for the item's category → `403`
- **OnEvent('order.paid')** → `DeliveryService.deliverDigitalLines(orderId)` runs per-item: assigns a license key in a transaction (SELECT … FOR UPDATE SKIP LOCKED idiom via `findFirst({ where: AVAILABLE })` + status flip with `update where status=AVAILABLE`) or generates a signed URL row.
- **Shipping label generator** reads `product.hsnCode` per line item and prints it in a "Customs" block when shipping country ≠ origin country.

## 5. Frontend deliverables

### Buyer (`apps/buyer-web`)
- `<AgeGate />` modal — shown on PDP load for age-restricted products. Captures DOB + checkbox. POSTs to `/compliance/age-consent` and stores a 30-day-TTL cookie (`onsective_age_ok=1`) for fast re-entry.
- PDP shows a "Restricted in your country" banner when the buyer's chosen default shipping country is blocked for that product.
- `/account/downloads` — list of digital deliveries for the current buyer with license code (revealed on click) and a "Download" button (mints a fresh signed URL on demand to respect TTL).
- Checkout shows a final compliance summary if any item is restricted, and the API rejection messages get surface-formatted instead of generic "checkout failed".

### Seller (`apps/seller-web`)
- `/compliance` — table of categories the seller is currently selling in, with required doc list, doc status badges, and an upload control per row.
- `/products/[id]/digital` — toggle "This is a digital product", pick `LICENSE_KEY` vs `FILE_DOWNLOAD`, upload the asset or paste a CSV/newline-list of license keys. Shows pool stats (available / assigned / revoked).
- Product create / edit form gains HSN code, tariff country, and (for digital toggle) a quick redirect to `/digital`.

### Admin (`apps/admin-web`)
- `/compliance` — two-pane:
  - left: `CategoryCompliance` editor (per category: min age, requirement kinds checklist, blocked / allowed countries, notes)
  - right: `SellerComplianceDoc` review queue with inline preview link, approve / reject / set expiry actions
- Sidebar entry; only visible when role=ADMIN.

## 6. Cryptography & secret handling

- License keys are AES-256-GCM encrypted at rest with `LICENSE_KEY_ENC_KEY` (32-byte base64, env). IV is generated per row; ciphertext stores `iv || tag || ct` base64. Decryption is gated behind `DigitalGoodsService.revealKey(orderItemId, userId)` which verifies the requesting user owns the order and only happens for keys whose `assignedOrderItemId` matches.
- Buyer-facing download URLs are MinIO presigned GETs with 5-minute TTL — generated on demand from `/downloads/:deliveryId/url` so a leaked URL has minimal lifetime.
- Age consent stores `sha256(ip + AGE_IP_SALT)` to satisfy the "we know which session consented" need without storing PII more than necessary.

## 7. Decisions log (Phase 5)

| ID | Decision | Rationale |
| -- | -------- | --------- |
| D-027 | Self-declared DOB + IP hash, not real KYC | Lets us ship age-gating immediately; admin can attach a higher-trust doc check per category. KYC provider integration is queued for Phase 6. |
| D-028 | License keys encrypted at rest (AES-GCM), not just hashed | Sellers need to display the actual key to buyers (vs. passwords where verification is enough); the encryption key lives outside the DB so a DB dump alone doesn't reveal keys. |
| D-029 | Download URLs always re-minted (no stored URL) | Aligns with "5-minute TTL means it actually expires"; nothing on disk to be leaked. `DigitalDelivery.downloadCount` enforces the cap. |
| D-030 | Country gate runs at checkout, not at search | Buyers should be able to browse globally; surface restrictions when they're about to commit. Also avoids needing GeoIP at request time for every listing fetch. |
| D-031 | Compliance metadata duplicated on `Product` (cached) | `requiresAgeCheck` + `minBuyerAge` mirror the `CategoryCompliance` so a single `findUnique` on PDP returns everything; admin updates the rule then runs `propagateToProducts()` which is wired into the rule-save flow. |
| D-032 | HSN codes are optional, surfaced only when shipping country differs from tariff country | Domestic shipments don't need customs metadata; pdfkit label only renders the customs block conditionally. |
| D-033 | `LicenseKey.codeFingerprint` is unique per pool | Lets a seller paste the same list twice without duplicate inserts; the second import reports "N already present" without revealing what they were. |

## 8. Exit criteria

- Admin can create a `CategoryCompliance` rule (e.g. "alcohol: minAge 21, blocked in IN+SA+PK") and seller PDP/cart enforce it.
- Seller can upload an alcohol license doc; admin can approve or reject; if rejected the seller's matching-category products cannot be sold.
- A buyer over 21 in an allowed country can complete a purchase; under-age or wrong-country buyers are blocked at PDP/cart/checkout with clear messaging.
- A digital `LICENSE_KEY` product with 3 pre-loaded keys lets 3 buyers complete an order and each sees a unique key on `/account/downloads`; the 4th buyer is rejected at checkout with `409 No license keys available`.
- A digital `FILE_DOWNLOAD` product mints a signed URL on demand; the URL expires in 5 minutes; the 6th download attempt is blocked (downloadLimit=5 default).
- HSN code appears on the customs section of the label PDF when shipping cross-border.
- `doc/phase-5-debug.md` lists all issues found and fixed.
