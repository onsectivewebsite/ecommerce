# Phase 15 — Debug Pass

Companion to `phase-15.md`. Calls out non-obvious decisions, the seams
where Phase 15 touches Phase 14 invariants, and what reviewers should
look at.

## 1. Non-obvious decisions

### 1.1 Quote signing instead of quote storage
We sign quotes with `createHmac('sha256', TRADEIN_QUOTE_SECRET)` and
hand the signature to the buyer. Acceptance verifies it inside
`acceptQuote()` with `timingSafeEqual`. The `quoteId` is recorded on
the resulting `TradeInOrder`, but the quote itself isn't persisted.
Trade-offs:

- **Plus**: no garbage rows, instant revocation by rotating the key.
- **Minus**: rotating the key invalidates outstanding quotes — buyers
  hitting "Accept" mid-rotation will see "Invalid quote signature." For
  Phase 15 we accept that; if quote volume grows, move to a sliding
  two-key window.

### 1.2 Phase 14 auth gate still runs after grading
When grading approves, we auto-create the RefurbUnit with
`availability = QUARANTINED`. The same `AuthenticityCheck` PASS gate
that all other refurb stock has to walk through still applies. This
intentionally avoids creating a second "trade-ins skip the gate"
backdoor: there is exactly one chokepoint for "stock goes live."

### 1.3 House seller bootstrapping is lazy
We don't ship a seed/migration that inserts the platform house-seller
(`storeName = onsective-house`). Instead `resolveSellerForRefurb()`
creates it on first use, anchored to the first ADMIN user's id. Pros:
no migration step required to install Phase 15. Cons: a sandbox with
no admin users will surface a clear "No admin user found" error
exactly when the first trade-in lands — that's better than silently
attaching units to a non-existent seller.

### 1.4 Payout-on-grade, not payout-on-auth
We pay out the buyer at grading approval, BEFORE the AuthenticityCheck
fires. Reasoning: from the buyer's perspective, once we've inspected
their device the deal is done — making them wait for our internal
re-list step would feel arbitrary. If a later anomaly is found,
clawback can be a follow-on phase.

### 1.5 Recompute payout when actualGrade < declaredGrade
`grade()` always recomputes the payout against the actual grade via
the same `computeOffer()` function used for the original quote. This
removes the incentive for buyers to overstate condition to inflate
the up-front number — the truth shows up at the warehouse.

### 1.6 In-process reverse-shipping label
`mockInboundLabel()` returns a placeholder until the buyer-side
trade-in mailer flow is real (separate effort). The shipping module
expects outbound labels keyed to orders; reverse labels for trade-ins
have a different lifecycle, so they live in the trade-in service for
now. When we wire a real carrier API for reverse labels, the boundary
between the two will look like Phase 13's RoutingService split.

### 1.7 Routing helper is local to trade-in
`chooseInboundWarehouse()` duplicates Phase 13's zone-match logic in
miniature (because Phase 13's `chooseForOrder` expects line items with
stock signals, which trade-ins don't have). Worth extracting if a
third caller appears — premature today.

### 1.8 No seller-health impact for buyer trade-in rejections
A buyer who consistently overstates condition is *abusing trade-ins*,
not selling. The spec calls for a `tradeInRejectRate` metric feeding
the risk engine. The data is there (count of orders by status per
buyer), but no metric/listener landed in Phase 15 — captured as a
follow-up in section 3.

## 2. What to test end-to-end

- Admin creates a TradeInModel: source product = "iPhone 13"
  (NEW_GENUINE), destination = "iPhone 13 (Refurbished)" (REFURB_GRADE_A),
  base $400, A=0.85, B=0.6, C=0.3, accessories `[{box, $5}]`.
- Buyer requests a quote: declared GRADE_A, accessories `[box]` →
  offer = round(400 * 0.85) + 5 = $345. Signature returned.
- Buyer accepts → `TradeInOrder` written with `status=KIT_SHIPPED`
  and a mock ship-back label URL.
- Warehouse calls `POST /warehouse/trade-in/intake` → status flips
  to `RECEIVED`.
- Warehouse calls `POST /warehouse/trade-in/grade` with
  `actualGrade=GRADE_B` → payout recomputes to $240 → wallet credit
  posts to buyer → status flips to `PAID` → RefurbUnit auto-created
  on the destination product (QUARANTINED).
- Run the Phase 14 AuthenticityCheck PASS for that RefurbUnit →
  variant `inventoryQty` becomes 1 → the device shows up on the
  destination product's PDP under the refurb picker.
- Reject path: grade as `REJECT` with a note → buyer notified, status
  `REJECTED`, no RefurbUnit created, no payout.
- Cancel path: buyer cancels before `RECEIVED` → status `CANCELLED`,
  no payout, ship-back label moot.

## 3. Known limitations

- No real reverse-shipping carrier integration — placeholder label only.
- No `tradeInRejectRate` metric → risk engine input not yet wired. The
  data is in `TradeInOrder.status`; one aggregation query, deferred.
- No Stripe payout path despite the schema field — `payoutMethod=STRIPE`
  short-circuits to no-op in dev. Wallet path is fully functional.
- No bulk trade-in (one device per order). Business buyback is a
  separate Phase that would batch into a single ship-back manifest.
- Cross-border trade-in deferred until the broader cross-border
  shipping story matures.

## 4. Files added

- `services/api/src/modules/trade-in/{trade-in.service,trade-in.controller,trade-in.module,dto}.ts`
- `packages/api-client/src/endpoints/trade-in.ts`
- `apps/admin-web/src/app/trade-in/page.tsx`
- `apps/buyer-web/src/app/trade-in/page.tsx`
- `apps/buyer-web/src/app/account/trade-ins/page.tsx`
- `apps/shipping-web/src/app/trade-in/page.tsx`

## 5. Files edited

- `services/api/prisma/schema.prisma` — added 4 enums (TradeInGrade,
  TradeInOrderStatus, TradeInPayoutMethod) + 4 models (TradeInModel,
  TradeInOrder, TradeInIntake, TradeInGrading) + back-relations on
  User, Seller, Warehouse, Product.
- `services/api/src/app.module.ts` — registered TradeInModule.
- `packages/api-client/src/index.ts` — re-exported TradeIn endpoints.
- `apps/{admin,buyer,shipping}-web/src/lib/api.ts` — wired
  `TradeInApi`. Admin and shipping additionally got `AuthenticityApi`
  exposure where missing.
- `apps/admin-web/src/components/Shell.tsx` — added "Trade-in" nav.
- `apps/shipping-web/src/components/Shell.tsx` — added "Trade-in intake".
- `apps/buyer-web/src/components/TopBar.tsx` — added a "Trade in" link.

## 6. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_15_tradein
pnpm -r typecheck
pnpm -r build
```

The migration adds significant new tables; review the generated SQL
for the `@@unique([sourceProductId])` constraint on `TradeInModel` (one
active offer per source product) and the FK chain
`TradeInOrder → TradeInModel → Product` to make sure the
`onDelete` defaults are what you want for your data-retention policy.
