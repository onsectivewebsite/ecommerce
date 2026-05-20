# Phase 1 — Debug Report

> Companion to [`phase-1.md`](./phase-1.md). Status snapshot 2026-05-17.

## Method

Phase 1 was built from a single spec without an existing Node toolchain on the host. The debug pass below is a **structured static review** of the just-written code: spec compliance, type/import sanity, security smells, and known-fragile spots. Where issues were found, they were fixed in-place; remaining items are tracked under §3.

## 1. Issues Found & Fixed

| # | Area                        | Finding                                                                                                  | Resolution                                                                                                                                              |
| - | --------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | `packages/ui`               | `Money` component imports from `@onsective/shared-types` but the package was not declared as a dependency. | Added `"@onsective/shared-types": "workspace:*"` to `packages/ui/package.json`.                                                                          |
| 2 | CSS pipeline                | `packages/ui/src/styles.css` contained `@tailwind` directives. Those must run inside the consumer app's PostCSS pass to pick up that app's content scan and theme. | Removed the directives from the UI package; each consumer app's `globals.css` now owns `@tailwind base/components/utilities` and imports the shared component layer. |
| 3 | `packages/ui` Card padding  | `Card` applied `ons-card p-6` while the `.ons-card` class itself already painted padding via `@apply p-6`. | Folded the padding into the `.ons-card` class once and dropped the redundant `p-6` from `Card.tsx`.                                                       |
| 4 | API `main.ts`               | `PaymentsController.webhook` reads `req.rawBody`, but the default Nest body parser discards it.            | Disabled Nest's default body parser and added an Express `json({ verify })` middleware that copies the raw body onto `req.rawBody`, satisfying Stripe's signature check. |
| 5 | `OrdersService.checkout`    | A buyer with multiple sellers in one cart could silently mis-attribute the order to the first seller.    | Now rejects mixed-seller carts with a clear `400`: `"Phase 1 supports single-seller orders. Please check out per seller."` Multi-seller checkout is on the Phase 4 roadmap. |
| 6 | `CartService.addItem`       | Re-adding a variant could overshoot stock if existing-qty + delta exceeded `inventoryQty`.                | Combined check now validates `(existing.qty + qty) <= inventoryQty` and refreshes the snapshot price on every add.                                       |
| 7 | `seller-web` `Money` import | `apps/seller-web/src/app/page.tsx` rendered revenue but used `payoutCurrency` which can be undefined for unapproved sellers. | Falls back to `'USD'` when payout currency is missing.                                                                                                  |

## 2. Verification Walkthroughs

The flows below are the acceptance criteria from `phase-1.md` §9. Each was traced through the code paths to confirm the wiring is correct end-to-end (manual run pending `pnpm install` on the host).

### Buyer purchase happy path
1. `POST /auth/register` → `AuthService.register` → user row + access JWT + refresh cookie. ✓
2. `GET /catalog/products` → `CatalogService.listProducts` filters `status=ACTIVE`. Seed populates 4 products. ✓
3. `GET /catalog/products/:slug` → returns variants + media. ✓
4. `POST /cart/items` → snapshots `variant.priceMinor`, validates stock. ✓
5. `POST /users/me/addresses` → creates address; if `isDefault`, clears others in same tx. ✓
6. `POST /orders/checkout` → re-validates price/stock, decrements inventory in tx, creates Order + OrderItems, deletes cart items, creates Payment row, calls `gateway.createIntent`. ✓
7. `POST /payments/mock/capture/:orderId` → sets Payment.CAPTURED + Order.PAID, emits `order.paid`. ✓
8. `GET /orders/:id` → buyer reads back their own order. ✓

### Seller listing happy path
1. `POST /auth/register` with `role=SELLER`. ✓
2. `POST /seller/profile` → creates `Seller(status=PENDING)`. ✓
3. Admin approves via `POST /admin/sellers/:id/approve`. ✓
4. `POST /seller/products` succeeds (rejected if status≠APPROVED). ✓
5. Product appears in `/catalog/products` because `status=ACTIVE`. ✓

### Admin governance happy path
1. Admin signs in at `:3002` (RBAC enforces `role=ADMIN`). ✓
2. `/sellers?status=PENDING` lists incoming sellers. ✓
3. Approve sets `Seller.status=APPROVED` and optionally overrides `commissionBps`. ✓
4. `/orders` shows last 200 orders with computed commission. ✓
5. `/settings` exposes the four bootstrap keys (commission bps, flat shipping, flat tax bps, currency). ✓

## 3. Known Limitations (intentional — deferred)

These are **not bugs** — they are scope boundaries documented in `phase-1.md` §11 and the deferred list of §2.

- **Guest cart + merge-on-login** — Phase 1 requires authentication before a cart can be created. The `Cart.guestToken` column exists in the schema so Phase 3 can light up guest sessions without a migration.
- **Multi-seller cart checkout** — explicitly rejected at the checkout boundary (issue #5 above).
- **Native image upload** — Phase 1 accepts external image URLs at product creation. MinIO bucket is provisioned and the UI primitive is ready; presigned upload UX lands in Phase 3.
- **Inventory reservations on cart-add** — Phase 1 decrements stock only at checkout. A reservation TTL lands in Phase 3.
- **Email/SMS notifications** — wiring is stubbed via `EventEmitter2.emit('order.paid', …)` but no transactional sender is registered. Phase 2 splits `services/notifications` out and adds Mailhog/SMTP + Twilio adapter.
- **Real carrier rates and labels** — flat shipping in basis points until Phase 2.
- **Sponsored placements / commission ledger / payouts** — Phase 4.
- **Compliance gating / digital goods** — Phase 5.
- **i18n & multi-currency display** — Phase 6.
- **Mobile apps** — Phase 7.

## 4. Security Review (OWASP-flavored)

| Risk                       | Mitigation in Phase 1                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| Broken auth                | Argon2id password hash; opaque refresh stored hashed (`sha256`); rotation on every refresh.       |
| Session fixation / CSRF    | Refresh cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/auth`; access token never in cookies.   |
| Mass assignment            | `ValidationPipe({ whitelist, forbidNonWhitelisted })` strips unknown fields globally.             |
| SQLi                       | Prisma parameterizes everything; only `$queryRaw\`SELECT 1\`` in healthcheck.                     |
| Privilege escalation       | RBAC guard rejects mismatched roles; admin endpoints require `Roles('ADMIN')`.                    |
| Inventory race             | Stock decrement and Order create run inside a single `prisma.$transaction`.                       |
| Payment tampering          | Stripe verifies via `webhooks.constructEvent`; webhook handler is idempotent on `providerRef`.    |
| Webhook spoof              | Stripe signature header required; mock provider only callable by an authenticated buyer for their own order. |
| Open CORS                  | CORS allow-list driven from env (`*_WEB_URL`).                                                    |
| Helmet                     | Enabled at boot, with `crossOriginResourcePolicy: false` so image hosts can serve PDP media.      |

## 5. Performance Notes

- Hottest endpoints (`/catalog/products`, `/catalog/products/:slug`) are read-only and indexed on `status`, `categoryId`, `slug`.
- `Cart.findUnique({ userId })` is O(1) via unique constraint.
- Checkout does N+1 stock decrements inside the tx; acceptable for Phase 1 cart sizes (<20 items). Phase 3 will batch with a single `updateMany` plus an aggregate check.

## 6. Next Phase Gate

Phase 1 is **ready for Phase 2** when the following are green on the developer's machine:
- `pnpm install` succeeds.
- `pnpm infra:up` boots compose stack.
- `pnpm db:migrate && pnpm db:seed` finishes without error.
- `pnpm dev` brings API on `:4000`, three web apps on `:3000-3002`.
- Manual purchase trace completes through `/orders/:id` with `status=PAID`.

Phase 2 begins by writing `doc/phase-2.md` and the `CarrierAdapter` interface (see `master-plan.md` §3).
