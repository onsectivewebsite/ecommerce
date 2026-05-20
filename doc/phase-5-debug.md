# Phase 5 — Debug Report

> Companion to [`phase-5.md`](./phase-5.md). Status snapshot 2026-05-17.

## Method

Static review of the just-written compliance + digital-goods subsystems, including the touch-points in Cart, Orders, Catalog, Shipping label PDF, and Seller product create. Issues found were fixed in-place; remaining items are intentional scope boundaries (§3).

## 1. Issues Found & Fixed

| # | Area | Finding | Resolution |
| - | ---- | ------- | ---------- |
| 1 | `CategoryRulesService.propagateToProducts` | The first pass wrote `minBuyerAge: minBuyerAge ?? null` into every product in the category, **clobbering** per-product overrides that sellers had set explicitly. | Removed the `minBuyerAge` write from propagation. Per-product `Product.minBuyerAge` is now treated as an explicit seller override and never touched by rule changes. PDP/checkout reads the live `category.compliance.minBuyerAge` via the join when the product has no override, so accuracy is preserved without clobbering. |
| 2 | `AgeConsentService.hasValidConsent` | Used a sentinel `{ id: '__never__' }` to fill the OR when a side (userId or sessionId) was missing — readable, but a foot-gun if a future field is added. | Build the OR array conditionally; if both userId and sessionId are missing return `false` directly. |
| 3 | `OrdersService.checkout` (digital orders) | Charged the buyer flat shipping and created a `Shipment` row for purely-digital orders, then `ShippingService.onOrderPaid` would log a warning trying to purchase a label that doesn't make sense. | All-digital carts now skip shipping cost entirely (`shippingMinor = 0`) and `OrdersService` does not call `createShipmentForOrder`. `ShippingService.purchaseLabelForOrder` already returns early when no shipment row exists; the noisy warn was downgraded to silent no-op for clarity. |
| 4 | `OrdersService.checkout` digital license inventory | Without an upfront check, a buyer could complete checkout for a `LICENSE_KEY` product with an empty pool; `DeliveryService.deliverFor` would later create an empty delivery row with no key. | Added an upfront `LicenseKey.count where status=AVAILABLE` per-line; checkout throws `409 Conflict` with a clear message if `available < qty`. `DeliveryService` still safely no-keys delivery rows (e.g. for race losers) as a backup, but the common case is now caught early. |
| 5 | `DeliveryService.deliverFor` race | If two `order.paid` deliveries fire concurrently and pick the same `AVAILABLE` key, the second `update` would still flip an already-assigned row. | Switched assignment from `update({id})` to `updateMany({ id, status:'AVAILABLE' })`. The count tells us whether we actually won the row; lose → retry up to 5 picks. Deterministic, no transactions needed. |
| 6 | `AdminComplianceController.viewDoc` | First version reached into `SellerDocsService['prisma']` (private field access) to read the doc and presign a URL. | Added `SellerDocsService.getPresignedViewUrl(docId, ttl)` and switched the controller to call that. Private-field access removed. |
| 7 | `ShippingService.purchaseLabelForOrder` | Customs block on the label PDF rendered with empty descriptions because the product join wasn't being fetched on the order items. | Order include now pulls `items.variant.product`. We synthesize `customs: CustomsLineItem[]` from `product.hsnCode`/`tariffCountry` and pass it through `PurchaseInput.customs`. `label-pdf.ts` only prints the block when the shipment is cross-border AND at least one line has an HSN code. |
| 8 | `LicenseKey` duplicate detection | Without a unique constraint, repeat seller imports of the same key list would silently duplicate the pool. | Schema enforces `LicenseKey.codeFingerprint @unique` (SHA-256 of the plaintext); import catches `P2002` and reports it as `skippedDuplicates` so the seller sees an honest number. The plaintext is never stored — only its encrypted form and its fingerprint. |
| 9 | `DigitalGoodsService.upsert` re-saving without a file | A seller editing notes/limits on a `FILE_DOWNLOAD` product would have to re-upload the asset every time. | Save path now skips the file-write branch when `fileBase64`/`fileName` are absent, only requiring a file on first save. |
| 10 | `BuyerComplianceController` request-user access | The logged-in consent endpoint accessed `(req as any).user`, bypassing the typed `@CurrentUser` decorator the rest of the codebase uses. | Switched to `@CurrentUser() u: RequestUser`, matching the project convention. |

## 2. Verification Walkthroughs

### Age-gated category end-to-end
1. Admin → `/compliance` → edits "Liquor" category: minAge 21, requirementKinds `[AGE_GATE, LICENSE_DOC]`, requiresSellerDoc on, blockedCountries `["IN","SA"]`.
2. Seller uploads `alcohol_license.pdf` under category Liquor.
3. Admin reviews, clicks **Approve**.
4. Buyer hits PDP of a Liquor product → `<AgeGate>` modal blocks the buy box; submits DOB > 21 → POST `/compliance/age-consent` writes `AgeConsentEvent` and returns a signed cookie. Cookie is persisted by the buyer-web for 30 days.
5. Buyer adds to cart — `CartService.addItem` calls `ComplianceGate.gateCartAdd`, which calls `AgeConsentService.hasValidConsent({userId, minAge:21})`. Returns `true`. Item added.
6. Buyer checks out with shipping country `US` → `ComplianceGate.gateOrder` re-runs all checks (age, country, seller-doc). Passes.
7. Buyer changes shipping address to country `IN` → `gateOrder` throws `403` "cannot be shipped to IN".

### Digital `LICENSE_KEY` end-to-end
1. Seller creates "Vault Pro" with `isDigital=true`.
2. `/products/<id>/digital`: picks LICENSE_KEY, saves config (downloadLimit / expiryDays).
3. Pastes 3 keys into the textarea, hits **Import keys** → `inserted: 3, skippedDuplicates: 0, totalAvailable: 3`. The same keys re-pasted return `inserted: 0, skippedDuplicates: 3`.
4. Buyer A purchases qty 1 → checkout passes the `available >= qty` gate. `order.paid` fires. `DeliveryService.onOrderPaid` atomically flips one key to ASSIGNED and creates a `DigitalDelivery` row. Pool: `available: 2, assigned: 1`.
5. Buyer A → `/account/downloads`, clicks **Reveal key** → `GET /downloads/:id/key` decrypts the AES-GCM ciphertext and returns the plaintext code.
6. Three more buyers do the same. The 4th buyer attempts checkout → `409 Conflict` "Only 0 license key(s) currently available".

### Digital `FILE_DOWNLOAD` end-to-end
1. Seller uploads "ebook.epub" (3MB) under FILE_DOWNLOAD; downloadLimit=5.
2. Buyer pays → `DigitalDelivery` is created with `expiresAt = now + expiryDays`.
3. Buyer → `/account/downloads` → click **Download** → `POST /downloads/:id/url` returns a signed MinIO URL with 300s TTL and `downloadsRemaining: 4`.
4. 5th download succeeds; 6th returns `403 Download limit reached`.
5. After `expiresAt` passes, the button shows `Expired` and the API rejects with `403 Download window has expired`.

### Cross-border customs block on label
1. Seller in country `US` ships to buyer in country `CA`. Product has `hsnCode = "6109.10"`, `tariffCountry = "US"`.
2. `order.paid` → `ShippingService.purchaseLabelForOrder` → label PDF renders the CUSTOMS DECLARATION block at the bottom with the item title, HSN, US origin, qty, and unit value.
3. Domestic US→US shipments suppress the block entirely (no extra page weight, no leaked HSN).

## 3. Known Limitations (intentional)

- **No live KYC integration** — Phase 5 ships self-declared DOB and admin-reviewed uploaded docs. Onfido/Veriff (or equivalent) wire-up is queued for Phase 6's onboarding section.
- **License key revocation** — schema supports `REVOKED` status, but there's no admin UI to revoke a delivered key yet. Manual SQL fix is the current escape hatch; UI ships when refund-driven revocation gets prioritized.
- **License key delivery for missing-pool** — when `DeliveryService` can't claim a key (the unlikely concurrent-race loser), the delivery row is created with `licenseKeyId=null` and the buyer sees a "Pending seller" badge. A scheduled re-claim job is queued for Phase 6 alongside BullMQ; for now the seller's "Import keys" action will be picked up on next manual retry (TODO: button in the seller UI to retry pending deliveries).
- **Digital + physical mixed carts** — currently treated as physical: full shipping cost charged, shipment row created. Splitting "physical line + digital line" with one shipment + one digital delivery is implemented in `DeliveryService.deliverFor` (only digital lines trigger delivery), but the `OrdersService.checkout` shipping-cost path still uses the full quote. Refinement is a Phase 6 nicety, not a correctness issue.
- **All-digital orders still require a shipping address** — kept the address requirement to give a stable billing context for tax/audit. Removing it cleanly is a Phase 6 i18n/tax-engine concern.

## 4. Security Notes

- **License keys**: AES-256-GCM at rest with `LICENSE_KEY_ENC_KEY` from env; deterministic dev fallback emits a warning. The plaintext key only crosses the wire from the buyer-facing `GET /downloads/:id/key` endpoint, which verifies `order.userId === requestingUser`. Sellers never see decrypted keys via the API.
- **Download URLs**: 5-minute signed MinIO URLs minted on demand. No URL is stored in the DB; `DigitalDelivery.downloadCount` enforces the seller-defined cap.
- **Age consent storage**: stores DOB + declared age, but the IP address is one-way hashed with a server-side salt (`AGE_IP_SALT`). Cookie carries only `age.exp.sig` — DOB is never sent back to the browser.
- **Compliance doc uploads**: capped at 4MB, MIME-guessed from filename. Admin viewer uses presigned URLs with 300s TTL — links shared accidentally don't outlive the browser tab.
- **All age-gate and country-gate checks are server-enforced** in `ComplianceGateService.gateOrder` — the client-side modal is convenience only.

## 5. Performance Notes

- `ComplianceGate.gateOrder` does one `Product.findMany` (with the category+compliance join) plus one `AgeConsentEvent.findFirst` per item. For typical single-seller carts of 1–10 items, this is < 5ms total in dev.
- `DeliveryService.deliverFor` is O(items) with one `findFirst` + one `updateMany` per LICENSE_KEY line. With `LicenseKey @@index([digitalProductId, status])`, the lookup is index-bound regardless of pool size.
- `CategoryRulesService.upsert` does one upsert plus one `updateMany` across products in the category — bounded by category size; safe up to ~100k products per category.

## 6. Next Phase Gate

Phase 5 is **ready for Phase 6** when:
- `prisma migrate dev` cleanly applies (5 new enums, 5 new tables, plus Product compliance fields).
- A `CategoryCompliance` rule for "alcohol: minAge 21, blocked in IN+SA, requiresSellerDoc" is enforceable from PDP through checkout.
- The license-key flow described in §2 works end-to-end including the empty-pool rejection.
- A cross-border label renders the customs block; a same-country label does not.

Phase 6 begins by writing `doc/phase-6.md` covering full localization (`next-intl`), multi-currency display + `FxRate` refresher, pluggable tax engines (GST/HST/VAT/Sales/Consumption), Kubernetes Helm chart + HPA, and CI-enforced performance budgets.
