# Onsective — Build Progress Tracker

> **How to use:** when the user says "continue", open this file, do the first unchecked box, then tick it with today's date. See [`master-plan.md`](./master-plan.md) §8.

Legend: ⚪ planned · 🟡 in progress · 🟢 done

---

## Phase 1 — Foundation & MVP 🟢

### Docs & planning
- [x] Master plan written — 2026-05-17
- [x] PROGRESS tracker written — 2026-05-17
- [x] `doc/phase-1.md` spec written — 2026-05-17

### Monorepo
- [x] Root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` — 2026-05-17
- [x] Docker Compose: postgres, redis, minio, mailhog — 2026-05-17
- [x] `.editorconfig` / `.prettierrc` / `.gitignore` — 2026-05-17 (pre-existing, kept)

### Shared packages
- [x] `packages/shared-types` — Money, ApiError, enums, DTOs — 2026-05-17
- [x] `packages/api-client` — typed fetch wrapper with auth handling — 2026-05-17
- [x] `packages/ui` — Tailwind tokens, Button, Input, Card, Badge, premium dark theme — 2026-05-17

### Backend (services/api)
- [x] NestJS bootstrap, config module, Prisma module, health endpoint — 2026-05-17
- [x] Prisma schema: User, RefreshToken, Address, Seller, Category, Product, ProductVariant, Media, Cart, CartItem, Order, OrderItem, Payment, AdminSetting — 2026-05-17
- [x] Seed script (admin user, sample seller, categories, products) — 2026-05-17
- [x] Auth module — register, login, refresh, logout, current-user, RBAC guard — 2026-05-17
- [x] Catalog module — categories, products list/detail/search, seller product CRUD — 2026-05-17
- [x] Cart module — get, add, update, remove, merge-on-login — 2026-05-17
- [x] Orders module — checkout, get, list (buyer + seller views) — 2026-05-17
- [x] Payments module — `PaymentGateway` interface, MockProvider, StripeProvider — 2026-05-17
- [x] Admin module — sellers approval, commission settings, order overview — 2026-05-17
- [x] OpenAPI / Swagger at `/docs` — 2026-05-17

### Buyer Web (apps/buyer-web)
- [x] Next.js 14 app, premium dark-first theme, shared `ui` package wired — 2026-05-17
- [x] Home, category browse, search results — 2026-05-17
- [x] PDP, cart, address book, checkout, order confirmation — 2026-05-17
- [x] Auth pages (login, register), account/orders — 2026-05-17

### Seller Web (apps/seller-web)
- [x] Auth + onboarding flow — 2026-05-17
- [x] Dashboard skeleton, product list + create form, orders queue — 2026-05-17

### Admin Web (apps/admin-web)
- [x] Auth + role gate — 2026-05-17
- [x] Seller approval queue, commission settings, order overview, platform settings — 2026-05-17

### Phase 1 close-out
- [x] `doc/phase-1-debug.md` written — 2026-05-17
- [x] README quick-start instructions — 2026-05-17

---

## Phase 2 — Shipping & Logistics 🟢
- [x] `doc/phase-2.md` spec — 2026-05-17
- [x] `CarrierAdapter` interface + Mock adapter — 2026-05-17
- [x] FedEx, UPS, DHL, Canada Post adapters (each gated by env flag) — 2026-05-17
- [x] `ShippingRule` model + admin UI — 2026-05-17
- [x] Label PDF generator (pdfkit) — 2026-05-17
- [x] `apps/shipping-web` portal (pickup queue, scan, milestones) — 2026-05-17
- [x] Socket.IO tracking push + buyer tracking page — 2026-05-17
- [x] `doc/phase-2-debug.md` — 2026-05-17

## Phase 3 — Seller Power Tools 🟢
- [x] `doc/phase-3.md` spec — 2026-05-17
- [x] CSV/XLSX bulk import with validation report — 2026-05-17 (CSV only; XLSX deferred to Phase 6)
- [x] Inventory reservations (cart TTL 15m) — 2026-05-17 (variant matrix editor deferred to Phase 4)
- [x] Analytics endpoints + seller dashboard — 2026-05-17 (materialized views deferred to Phase 6)
- [x] Subscription tiers + `SubscriptionGuard` — 2026-05-17
- [x] Listing-fee engine + audit log — 2026-05-17
- [x] `doc/phase-3-debug.md` — 2026-05-17

## Phase 4 — Revenue & Advertising 🟢
- [x] `doc/phase-4.md` spec — 2026-05-17
- [x] `SponsoredProduct`, `SearchSponsor`, `BannerSlot` + CPC/CPM auction — 2026-05-17
- [x] Commission engine + double-entry `LedgerEntry` — 2026-05-17
- [x] Payout pipeline (Stripe Connect + manual fallback; nightly via PAYOUTS_AUTO_RUN) — 2026-05-17
- [x] Admin revenue dashboard + payouts queue — 2026-05-17
- [x] `doc/phase-4-debug.md` — 2026-05-17

## Phase 5 — Compliance & Regulated Products 🟢
- [x] `doc/phase-5.md` spec — 2026-05-17
- [x] `CategoryCompliance` rules + seller workspace — 2026-05-17
- [x] Age-gate component + consent storage — 2026-05-17
- [x] Digital goods: `LicenseKeyPool`, signed-URL downloads — 2026-05-17
- [x] HSN/tariff codes — 2026-05-17
- [x] `doc/phase-5-debug.md` — 2026-05-17

## Phase 6 — i18n & Scale Hardening 🟢
- [x] `doc/phase-6.md` spec — 2026-05-17
- [x] `packages/i18n` + locale catalogs (en/hi/fr/ja/zh/ur/bn/vi/ru) + buyer-web switcher — 2026-05-17 (custom thin context in lieu of next-intl dep)
- [x] Multi-currency display with `FxRate` refresher — 2026-05-17
- [x] Pluggable tax strategies (GST/HST/VAT/Sales/Consumption) — 2026-05-17
- [x] Kubernetes Helm chart + HPA — 2026-05-17
- [x] Performance budgets enforced in CI — 2026-05-17
- [x] `doc/phase-6-debug.md` — 2026-05-17

## Phase 7 — Mobile Apps 🟢
- [x] `doc/phase-7.md` spec — 2026-05-17
- [x] Expo app scaffold consuming `api-client` — 2026-05-17
- [x] Screens: onboarding → checkout → orders → tracking — 2026-05-17
- [x] Apple/Google Pay where supported — 2026-05-17
- [x] Push notifications (Expo + self-hosted FCM proxy via EXPO_PUSH_URL env) — 2026-05-17
- [x] Deep links + universal links — 2026-05-17
- [x] `doc/phase-7-debug.md` — 2026-05-17

## Phase 8 — Intelligence & Polish 🟢
- [x] `doc/phase-8.md` spec — 2026-05-17
- [x] ES relevance tuning + indexer (with PG fallback when ES not configured) — 2026-05-17
- [x] Recommender (FBT via ProductCoView, similar-PDP via SQL, "for you" rail) — 2026-05-17
- [x] GrowthBook-compatible self-hosted A/B (features payload + sticky bucketing + admin CRUD) — 2026-05-17
- [x] WCAG 2.1 AA targeted fixes (AgeGate dialog, focus rings on rec links, ARIA labels) — 2026-05-17
- [x] k6 load test scripts (read-mix, checkout, inventory-burst) + `doc/dr-runbook.md` — 2026-05-17
- [x] `doc/phase-8-debug.md` — 2026-05-17

## Phase 9 — Marketplace Trust & Operations ✅
- [x] `doc/phase-9.md` spec — 2026-05-17
- [x] Schema (Return, ReturnItem, Review, MessageThread, Message, Dispute) — 2026-05-17
- [x] PaymentsService.refund + ShippingService.purchaseReturnLabel + Stripe charge.dispute.created webhook — 2026-05-17
- [x] Returns module (request → approve → label → buyer drop-off / carrier scan → refund → ledger reverse via existing CommissionBooker) — 2026-05-17
- [x] Reviews module (1 per orderItem, 90-day window, seller one-time reply, admin hide/unhide, aggregate piped into ES SearchIndexer) — 2026-05-17
- [x] Messaging module (per-order thread, JWT-authenticated Socket.IO gateway + REST, MinIO presigned PUT attachments, per-party mute) — 2026-05-17
- [x] Support inbox + platform-refund (SLA-gated, override-logged) — 2026-05-17
- [x] Disputes module (buyer-opened, auto-opened from chargeback / return.escalated / missing_delivery, admin assign + resolve with refund integration) — 2026-05-17
- [x] NotificationsListener extended for return/review/dispute push categories — 2026-05-17
- [x] api-client endpoints (ReturnsApi, ReviewsApi, MessagingApi, DisputesApi, SupportApi) — 2026-05-17
- [x] Frontends (buyer: returns list/new/thread; seller: returns/reviews/messages; admin: returns/reviews/disputes/support inbox) — 2026-05-17
- [x] `doc/phase-9-debug.md` — 2026-05-17

## Phase 10 — Buyer Growth Engine ✅
- [x] `doc/phase-10.md` spec — 2026-05-18
- [x] Schema (Promotion, PromotionProductScope, PromotionRedemption, WalletAccount, WalletTransaction, Wishlist, WishlistItem, AbandonedCartNudge) + Order.promotionLines/walletAppliedMinor + Cart.recoverySuppressedAt — 2026-05-18
- [x] Promotions module (seller + admin CRUD, checkout evaluator with 1 seller + 1 platform stacking cap, per-user + total redemption caps, BOGO support) — 2026-05-18
- [x] Wallet module (asserted-balance ledger, admin grants, STORE_CREDIT refund wire-up in ReturnsService.runRefund, apply at checkout) — 2026-05-18
- [x] Wishlists module + 6h polling watcher for price drops / back-in-stock + share-token endpoint — 2026-05-18
- [x] Abandoned-cart scheduler (24h + 72h, opt-in incentive credit) — 2026-05-18
- [x] Checkout integration (promo + wallet apply with seller-vs-platform-aware commission base) — 2026-05-18
- [x] api-client endpoints (PromotionsApi, WalletApi, WishlistsApi) + CheckoutRequest/OrderDto extended — 2026-05-18
- [x] Frontends (buyer wishlist + wallet + checkout promo/wallet UI + PDP heart, seller promotions manager, admin promotions + wallet grants) — 2026-05-18
- [x] `doc/phase-10-debug.md` — 2026-05-18

## Phase 11 — Seller Success Suite ✅
- [x] `doc/phase-11.md` spec — 2026-05-18
- [x] Schema (NotificationPreference, ProductEvent, InventoryForecastAlert, SellerWebhookEndpoint, SellerWebhookDelivery + 4 enums) — 2026-05-18
- [x] Transactional email module (EmailProvider abstraction, Dev + Resend providers, inline templates, EmailListener mirrors push events) — 2026-05-18
- [x] NotificationPreferences gating (per-category email + push opt-out applied in NotificationsService and EmailService) — 2026-05-18
- [x] Seller analytics module (ProductEvent ingestion from catalog/cart/orders, funnel + top products + AOV trend + return-rate aggregations) — 2026-05-18
- [x] Inventory forecasting scheduler (14d velocity → daysUntilEmpty → WARNING/CRITICAL alerts with de-dup + acknowledge flow) — 2026-05-18
- [x] Seller webhooks module (CRUD + Stripe-style HMAC signature + Prisma-as-queue dispatcher with exponential backoff to DEAD) — 2026-05-18
- [x] OrdersService emits order.placed; CatalogService emits product.viewed; CartService emits cart.item.added; AbandonedCartService emits cart.recovery.queued — 2026-05-18
- [x] api-client endpoints (SellerAnalyticsApi, SellerWebhooksApi, InventoryForecastApi, PreferencesApi) — 2026-05-18
- [x] Frontends (seller: /analytics/funnel, /inventory/alerts, /webhooks + deliveries; buyer: /account/preferences) — 2026-05-18
- [x] `doc/phase-11-debug.md` — 2026-05-18

## Phase 12 — Trust, Safety & Operations ✅
- [x] `doc/phase-12.md` spec — 2026-05-18
- [x] Schema (RiskAssessment, RiskRuleHit, OrderHold, LoginEvent, StepUpChallenge, SellerHealthSnapshot + 4 enums) — 2026-05-18
- [x] Risk engine (rule interface + 5 built-in rules including seller-health amplifier + OrdersService.checkout integration with inventory-rollback on BLOCK + admin review queue + release re-emits order.paid) — 2026-05-18
- [x] Account security (hashed-IP LoginEvent capture, version-normalized UA fingerprint, new-device + impossible-travel anomalies, sign-in alert email, step-up email-code gate bound to challengeId) — 2026-05-18
- [x] Seller health score (daily snapshot with 5-order floor, composite weighted from dispute/chargeback/return/SLA rates, auto-suspend + email at < threshold, 30d trend exposed to seller dashboard) — 2026-05-18
- [x] Observability foundation (AsyncLocalStorage trace-id propagation, JsonLogger opt-in via LOG_FORMAT=json, /metrics Prometheus text endpoint with METRICS_TOKEN gate + event-driven counters + on-demand gauges) — 2026-05-18
- [x] EmailService templates extended with security_sign_in_alert, security_step_up_code, seller_health_low — 2026-05-18
- [x] api-client endpoints (RiskApi, SellerHealthApi, SecurityApi) — 2026-05-18
- [x] Frontends (admin: /risk queue + detail + /seller-health; seller: /health dashboard; buyer: /account/security activity log) — 2026-05-18
- [x] `doc/phase-12-debug.md` — 2026-05-18

## Phase 13 — Onsective Fulfillment ✅
- [x] `doc/phase-13.md` spec — 2026-05-18
- [x] Schema (Warehouse, WarehouseZone, InventoryStock, InboundShipment, InboundShipmentItem, StorageBillingRun + 4 enums + Product.fulfillmentMode + ProductVariant.cubicCm + OrderItem.fulfilledFromWarehouseId + OrderItem.pickedAt) — 2026-05-18
- [x] Warehouses module (admin CRUD + zones with country/regions, public read for seller picker) — 2026-05-18
- [x] InventoryStock module (per-warehouse stock with atomic rollup recompute to ProductVariant.inventoryQty inside the same Prisma $transaction) — 2026-05-18
- [x] Inbound shipments module (DRAFT → IN_TRANSIT → RECEIVED → CLOSED + per-line discrepancy capture + +10 over-receive guardrail + cancel flow) — 2026-05-18
- [x] Fulfillment routing (single-warehouse-per-order, zone-aware, priority-ranked, falls back to seller fulfillment if no single warehouse covers all platform-fulfilled lines) — 2026-05-18
- [x] Stock-debit listener on order.paid with pickedAt idempotency marker — 2026-05-18
- [x] Pick list endpoint + shipping-web /pick-list page (sortable by oldest order or by SKU for batch picking) — 2026-05-18
- [x] Storage fees daily accrual scheduler + read-side statement for sellers — 2026-05-18
- [x] api-client endpoints (WarehousesApi, InboundApi, PickListApi, StorageApi) — 2026-05-18
- [x] Frontends (admin: /warehouses CRUD; seller: /fulfillment/inbound list + /new; shipping-web: /pick-list) — 2026-05-18
- [x] `doc/phase-13-debug.md` — 2026-05-18

## Phase 14 — Authenticity & Certified Refurbished ✅
> **Positioning pivot**: Onsective is now certified-only retail. No open marketplace, no buyer-to-buyer, no drop-shipping.
- [x] `doc/phase-14.md` spec — 2026-05-18
- [x] Schema (Brand, BrandAuthorization, SellerCertification, RefurbUnit, AuthenticityCheck, WarrantyClaim + Product.condition + Product.brandId + RefurbUnit.variantId)
- [x] Brands + authorization module (admin CRUD, gate on publish)
- [x] Seller certification module (apply + admin review + expiry + publish gate)
- [x] RefurbUnit + per-unit listings (singleton-variant cart treatment, atomic SOLD transition in checkout tx)
- [x] Inbound authenticity check (mandatory before stock goes live; receive() no longer releases stock, only PASS does)
- [x] Warranty module (per-condition tiers, claim flow separate from returns, wallet refund / replacement / repair / reject)
- [x] Buyer trust UI (TrustBadge on PDP + cards, RefurbUnitPicker, `/verify` serial lookup, `/account/warranty` claim form)
- [x] api-client + frontends (admin brands/auth/cert/warranty/authenticity pages, seller cert + refurb-unit pages, buyer trust + warranty)
- [x] `doc/phase-14-debug.md`

## Phase 15 — Trade-in & Circular Loop ✅
- [x] `doc/phase-15.md` spec — 2026-05-18
- [x] Schema (TradeInModel, TradeInOrder, TradeInIntake, TradeInGrading + 3 enums + back-relations)
- [x] Trade-in quote engine (HMAC-signed quote, 24h TTL, accessory adjustments, declared-grade multiplier)
- [x] Trade-in order flow (buyer accept → inbound warehouse routing → mock ship-back label → status timeline)
- [x] Intake + grading + re-list (warehouse intake, technician grading, recompute payout if downgraded, wallet payout, auto-create RefurbUnit QUARANTINED on destination product)
- [x] api-client + frontends (buyer /trade-in + /account/trade-ins, shipping-web /trade-in intake-and-grade, admin /trade-in models)
- [x] `doc/phase-15-debug.md`

## Phase 16 — AI-assisted Authentication & Grading ✅
- [x] `doc/phase-16.md` spec — 2026-05-18
- [x] Schema (AiModel, AiInferenceRun, CounterfeitWatchEntry + RefurbUnit.aiSummary cache + AiModelKind enum)
- [x] AI provider interface + deterministic HeuristicVisionProvider + opt-in RemoteVisionProvider with heuristic fallback
- [x] Suggest endpoints (auth-check / grading / counterfeit) — read-only, never writes verdict; divergence captured in human's reason/notes
- [x] api-client + frontends (shipping-web trade-in grading panel pre-fills with AI suggestion; admin /ai-vision registry + watchlist; buyer PDP shows "Vision-verified" line)
- [x] `doc/phase-16-debug.md`

## Phase 17 — Brand Storefronts ✅
- [x] `doc/phase-17.md` spec — 2026-05-18
- [x] Schema (BrandMode enum + storefront fields + Brand.sellerId; BrandCollection + BrandCollectionProduct + back-relations)
- [x] Brand storefront service (assemble hero/story/collections, product feed via existing publish-gate filter via shared `filterProducts`)
- [x] Brand-as-seller bootstrap (promote a brand to INVENTORY_HOLDING with auto-created seller + 5y AUTHORIZED_RESELLER cert)
- [x] api-client + frontends (buyer /brand/[slug] storefront page, admin /brands/[id]/storefront editor with collection management)
- [x] `doc/phase-17-debug.md`

## Phase 18 — Returns Liquidation & Outlet ✅
- [x] `doc/phase-18.md` spec — 2026-05-18
- [x] Schema (ProductCondition.OPEN_BOX + ReturnDisposition enum + ReturnInspection model + back-relations on Return and Warehouse)
- [x] Return disposition + auto-relist service (OUTLET_RELIST creates QUARANTINED OPEN_BOX RefurbUnit with singleton variant; REFURB_REGRADE/DISPOSE/RETURN_TO_SELLER emit events)
- [x] api-client + frontends (buyer /outlet with condition filters + discount badges, shipping-web /returns inspection panel, admin /dispositions queue + counters)
- [x] `doc/phase-18-debug.md`

## Phase 19 — Repair Network & Service Tickets ✅
- [x] `doc/phase-19.md` spec — 2026-05-18
- [x] Schema (RepairPartner, ServiceTicket, ServiceTicketEvent + 3 enums + back-relations on User and WarrantyClaim)
- [x] Repair-network service (admin partner CRUD, capability+capacity routing, ticket lifecycle, COMPLETED writes WarrantyClaim; partner forward-only transitions)
- [x] Warranty integration (resolve(RESOLVED_REPAIR) auto-creates ticket and sets resolutionRef=ticket:<id>)
- [x] api-client + frontends (admin /repair-network registry + unassigned queue, shipping-web /repair partner portal, buyer warranty page shows per-claim ticket status + tracking)
- [x] `doc/phase-19-debug.md`

## Phase 20 — Sustainability & Trade Reporting ✅
- [x] `doc/phase-20.md` spec — 2026-05-18
- [x] Schema (SustainabilityFactor with optional brand override + SustainabilityImpact event log + SustainabilitySubjectKind enum)
- [x] Sustainability service + listeners on order.paid / tradein.order.paid / repair.ticket.completed (idempotent + snapshotted, never breaks primary flows)
- [x] api-client + frontends (buyer /account/impact, public /impact, brand storefront impact panel, admin /sustainability factor editor + platform stats)
- [x] `doc/phase-20-debug.md`

## Phase 21 — Multi-warehouse Smart Routing & SLA ✅
- [x] `doc/phase-21.md` spec — 2026-05-18
- [x] Schema (WarehouseSlaProfile + OrderItem promise snapshot fields + SlaBreach event log + SlaBreachKind enum)
- [x] Smart routing (chooseForOrderPerItem) + SLA service (CRUD + estimateForBuyer + snapshot helper) + SlaBreachScheduler with per-row event emission
- [x] Wire OrdersService.checkout to per-item routing + snapshot promise on each OrderItem
- [x] api-client + frontends (PDP "Get it by" line via SlaPromise component, admin /sla profiles + breach list + on-demand scan button)
- [x] `doc/phase-21-debug.md`

## Phase 22 — Loyalty & Membership ✅
- [x] `doc/phase-22.md` spec — 2026-05-18
- [x] Schema (PlusMembership + PointsAccount + PointsTransaction + RefurbUnit.firstListedAt + enums) — 2026-05-18
- [x] Membership + Points services (lazy-expire, idempotent earn via referenceKey, wallet-credit redemption) — 2026-05-18
- [x] Wire checkout free shipping for Plus + listener earning points on order.paid / tradein.order.paid / repair.ticket.completed — 2026-05-18
- [x] api-client + frontends (/account/membership, /account/points, TopBar Plus chip, refurb extended warranty for Plus, outlet early access) — 2026-05-18
- [x] `doc/phase-22-debug.md` — 2026-05-18

## Phase 23 — Recurring Billing & Saved Cards ✅
- [x] `doc/phase-23.md` spec — 2026-05-18
- [x] Schema (PaymentMethod + MembershipBillingEvent + PlusMembership.providerSubscriptionId/autoRenew/currentPeriodEnd + MembershipStatus.PAUSED + MembershipBillingEventKind + PaymentMethodStatus enums) — 2026-05-18
- [x] PaymentMethodsService + Stripe customer/setup-intent/attach/detach + provider helpers — 2026-05-18
- [x] MembershipService recurring (Subscription create, cancel-at-period-end, drop mock_pay_ sentinel) — 2026-05-18
- [x] Subscription webhook handler (invoice.paid, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted) — idempotent on providerEventId — 2026-05-18
- [x] api-client + buyer-web (/account/payment-methods + membership UX with default card, next-renewal, auto-renew toggle) — 2026-05-18
- [x] `doc/phase-23-debug.md` — 2026-05-18

## Phase 24 — Saved-Card Checkout & Plus Ops ✅
- [x] `doc/phase-24.md` spec — 2026-05-18
- [x] Saved-card off-session checkout (StripePaymentProvider + OrdersService + 3DS reflow + buyer-web selector) — 2026-05-18
- [x] Plus lifecycle notifications (renewed / payment_failed / expired listeners + expiring-soon scheduler + email templates) — 2026-05-18
- [x] Admin Plus dashboard (/admin/plus stats + billing events) — 2026-05-18
- [x] `doc/phase-24-debug.md` — 2026-05-18

## Phase 25 — Buyer Referrals ✅
- [x] `doc/phase-25.md` spec — 2026-05-18
- [x] Schema (ReferralCode + ReferralRedemption + ReferralAbuseEvent + User.referralCodeUsed/signupIp + ReferralCodeStatus + ReferralRedemptionRejectionReason enums) — 2026-05-18
- [x] ReferralsService + signup capture in AuthService + payout listener on order.paid — 2026-05-18
- [x] api-client + buyer-web /account/referrals + signup ?ref= + admin /referrals — 2026-05-18
- [x] `doc/phase-25-debug.md` — 2026-05-18

## Phase 26 — Privacy, Data Export & Account Deletion ✅
- [x] `doc/phase-26.md` spec — 2026-05-18
- [x] Schema (DataExportRequest + DataExportStatus + DeletionRequestStatus + User deletion fields) — 2026-05-19
- [x] DataExportService + builder + scheduler (env-gated DATA_EXPORT_SCHEDULER_ENABLED, 7d expiry) — 2026-05-19
- [x] AccountDeletionService + scheduler (env-gated PRIVACY_DELETION_SCHEDULER_ENABLED) + auth integration (login refused for COMPLETED, /auth/me surfaces grace state) — 2026-05-19
- [x] api-client + buyer-web /account/privacy + admin /admin/privacy — 2026-05-19
- [x] `doc/phase-26-debug.md` — 2026-05-19

## Phase 27 — In-app Notification Center ✅
- [x] `doc/phase-27.md` spec — 2026-05-19
- [x] Schema (Notification model + NotificationKind enum + indexes) — 2026-05-19
- [x] NotificationFeedService + wire into Plus / referral / order / messaging listeners — 2026-05-19
- [x] Controller + api-client + buyer-web /account/inbox + TopBar bell badge (60s poll) — 2026-05-19
- [x] `doc/phase-27-debug.md` — 2026-05-19

## Phase 28 — SEO, Structured Data & Sitemaps ✅
- [x] `doc/phase-28.md` spec — 2026-05-19
- [x] SeoService + sitemap endpoints (index + chunked products + brands + categories + outlet) — 2026-05-19
- [x] Buyer-web /sitemap.xml proxy + /robots.txt + JsonLd component + generateMetadata on PDP/brand/outlet + canonical URLs — 2026-05-19
- [x] `doc/phase-28-debug.md` — 2026-05-19

## Phase 29 — Stripe Connect Seller Onboarding ✅
- [x] `doc/phase-29.md` spec — 2026-05-19
- [x] Schema (ConnectAccountStatus enum + Seller.payoutsEnabled/connectAccountStatus/connectRequirementsDue/connectOnboardedAt/connectLastSyncedAt) — 2026-05-19
- [x] StripeConnectService createAccountLink/retrieveAccount/createLoginLink + SellerOnboardingService startForUser/sync — 2026-05-19
- [x] Webhook account.updated → ConnectAccountListener sync; onboarding return/refresh endpoints; payout gate on payoutsEnabled — 2026-05-19
- [x] api-client + seller-web /seller/onboarding/payouts + persistent banner + admin api wiring (admin UI deferred) — 2026-05-19
- [x] `doc/phase-29-debug.md` — 2026-05-19

## Phase 30 — Rate Limiting & Abuse Prevention ✅
- [x] `doc/phase-30.md` spec — 2026-05-19
- [x] Schema (AbuseEvent + RateLimitBlock + AbuseEventKind + RateLimitBlockSource) — 2026-05-19
- [x] RateLimiterService (Redis sliding-window + in-memory fallback) + RateLimitGuard + @RateLimit decorator — 2026-05-19
- [x] Apply rate limits to 7 high-risk endpoints (login, register, checkout, setup-intent, redeem, data-export, messaging.send) + admin /admin/security/rate-limits endpoints + admin /rate-limits page — 2026-05-19
- [x] `doc/phase-30-debug.md` — 2026-05-19

## Phase 31 — Two-Factor Authentication (TOTP) ✅
- [x] `doc/phase-31.md` spec — 2026-05-19
- [x] Schema (TotpEnrollment, RecoveryCode, TwoFactorChallenge + enums; User.twoFactorEnabled) — 2026-05-19
- [x] TwoFactorService: RFC6238 TOTP (HMAC-SHA1, 6/30s, ±1 step + replay guard), AES-256-GCM secret-at-rest, argon2 recovery codes, login + disable challenges, admin reset — 2026-05-19
- [x] Auth flow: /auth/login returns mfaRequired when enabled, /auth/2fa/{verify,status,enroll/start,enroll/verify,disable,recovery-codes/regenerate}, /admin/users/:id/2fa/reset; rate-limited every verify/enroll/regen endpoint — 2026-05-19
- [x] Frontend: buyer-web /account/security enroll/disable/regen + login challenge step; admin-web /security reset page + nav; seller-web + shipping-web login challenge handling; mobile gracefully errors — 2026-05-19
- [x] `doc/phase-31-debug.md` — 2026-05-19

## Phase 32 — Cookie Consent & Marketing Preferences ✅
- [x] `doc/phase-32.md` spec — 2026-05-19
- [x] Schema (ConsentRecord, ConsentEvent, UnsubscribeToken + 3 enums; User back-relations) — 2026-05-19
- [x] ConsentService (capture, resolveOnLogin, updatePreferences, canSendMarketingEmail, unsubscribe tokens, admin metrics) + region detection (CF/Vercel/Fastly + Accept-Language) — 2026-05-19
- [x] /privacy endpoints (consent GET/POST, preferences PATCH, unsubscribe lookup+consume), /admin/privacy/consent/metrics, AuthController folds anon → user on login/register/2fa-verify — 2026-05-19
- [x] Email service gates marketing kinds on consent, auto-appends one-shot unsubscribe footer; templateKind() taxonomy — 2026-05-19
- [x] Buyer-web ConsentBanner in layout, /unsubscribe page, /account/preferences master switches, /legal/cookies policy page; admin-web /privacy consent metrics section — 2026-05-19
- [x] `doc/phase-32-debug.md` — 2026-05-19

## Phase 33 — WebAuthn / Passkeys ✅
- [x] `doc/phase-33.md` spec — 2026-05-19
- [x] Schema (WebAuthnCredential + transport enum; 2 new TwoFactorChallengeKind values) — 2026-05-19
- [x] WebAuthn service: hand-rolled CBOR decoder, COSE→DER for ES256/RS256/EdDSA, authData parser, registration + assertion verification with counter replay guard, discoverable-flow anchor user — 2026-05-19
- [x] Endpoints: /auth/webauthn/{register/options,register/verify,login/options,login/verify,credentials,credentials/:id/remove} + /auth/2fa/verify-passkey + /admin/users/:id/webauthn/reset — 2026-05-19
- [x] Frontend: lib/webauthn.ts helpers, PasskeysCard on /account/security, login-page "Sign in with passkey" + "Use a passkey instead" on 2FA step, admin-web /security passkey reset — 2026-05-19
- [x] `doc/phase-33-debug.md` — 2026-05-19

## Phase 34 — Account Recovery ✅
- [x] `doc/phase-34.md` spec — 2026-05-20
- [x] Schema (PasswordResetToken, AccountRecoveryRequest, RecoveryRequestStatus enum; User back-relations) — 2026-05-20
- [x] PasswordResetService (enumeration-safe forgot, token reset, session revoke) + AccountRecoveryService (72h window, confirm/cancel/complete, token rotation) + scheduler + 7 email templates — 2026-05-20
- [x] Endpoints: /auth/password/{forgot,reset}, /auth/recovery/{start,confirm,cancel,status,complete}, /admin/security/recovery-requests{,/:id/cancel,/scan} — 2026-05-20
- [x] Frontend: buyer-web /forgot-password, /reset-password, /account-recovery + confirm/cancel/complete pages, login-page link; admin-web /security recovery-requests table — 2026-05-20
- [x] `doc/phase-34-debug.md` — 2026-05-20

## Phase 35 — Gift Cards & Store Credit ✅
- [x] `doc/phase-35.md` spec — 2026-05-20
- [x] Schema (GiftCard model + GiftCardStatus enum + CREDIT_GIFT_CARD WalletTxnKind; PaymentIntentInput/WebhookEvent giftCardId plumbing) — 2026-05-20
- [x] GiftCardsService (purchase via Stripe PI, redeem-to-wallet with concurrent-claim guard, check, admin issue/void, lazy expiry) + listener + delivery scheduler + 2 email templates — 2026-05-20
- [x] Endpoints: /gift-cards/{purchase,check,redeem,mine} + /admin/gift-cards{,/issue,/:id/void,/deliver-due}; webhook giftcard branch; GiftCardsApi + AdminGiftCardsApi — 2026-05-20
- [x] Frontend: buyer-web /gift-cards purchase (Stripe Elements) + /account/gift-cards redeem; admin-web /gift-cards issue/void/search + nav; TopBar link — 2026-05-20
- [x] `doc/phase-35-debug.md` — 2026-05-20

## Deployment — Hostinger VPS ✅
- [x] Provisioned Hostinger VPS (Ubuntu 24.04, CloudPanel), code via GitHub, env + secrets, DB migrate + seed — 2026-05-20
- [x] 5 pm2 services (API via @swc-node/register, 4 Next.js apps), CloudPanel reverse-proxy + Let's Encrypt TLS on itsnottechy.cloud + 4 subdomains — 2026-05-20
- [x] SMTP email provider (nodemailer, Hostinger), live smoke test (login, catalog, email) — 2026-05-20

## Phase 36 — Product Q&A ✅
- [x] `doc/phase-36.md` spec — 2026-05-20
- [x] Schema (ProductQuestion, ProductAnswer, AnswerHelpfulVote + QnaStatus/QnaAuthorRole enums + QUESTION_ANSWERED NotificationKind) — 2026-05-20
- [x] QnaService (ask, answer w/ author-role snapshot, toggle-helpful, author soft-delete, seller/admin lists, moderation) + rate limits + answer→asker notification — 2026-05-20
- [x] Endpoints: /qna/* (public + buyer), /seller/qna, /admin/qna; QnaApi in api-client — 2026-05-20
- [x] Frontend: buyer-web ProductQna on PDP + /account/qna; seller-web /qna; admin-web /qna; nav + account tile — 2026-05-20
- [x] `doc/phase-36-debug.md` — 2026-05-20

## Phase 37 — Subscribe & Save ✅
- [x] `doc/phase-37.md` spec — 2026-05-22
- [x] Schema (ProductSubscription model + AutoshipStatus enum + relations) — 2026-05-22
- [x] OrdersService.createSubscriptionOrder (isolated off-session order path, stranded-order rollback) — 2026-05-22
- [x] AutoshipService (subscribe/list/update/skip/pause/resume/cancel + processDue) + env-gated AutoshipScheduler + dunning — 2026-05-22
- [x] Endpoints: /autoship/* + /admin/autoship/scan; AutoshipApi in api-client — 2026-05-22
- [x] Frontend: buyer-web SubscribeSave on PDP + /account/subscriptions + account tile — 2026-05-22
- [x] `doc/phase-37-debug.md` — 2026-05-22

## Phase 38 — Product Comparison ✅
- [x] `doc/phase-38.md` spec — 2026-05-22
- [x] Schema (ComparisonItem model + relations) — 2026-05-22
- [x] ComparisonService (list/add/remove/clear, cap 4, hydrated with rating + attributes) + /comparison endpoints — 2026-05-22
- [x] ComparisonApi in api-client — 2026-05-22
- [x] Frontend: buyer-web CompareButton on PDP + /compare side-by-side table + TopBar link — 2026-05-22
- [x] `doc/phase-38-debug.md` — 2026-05-22

## Phase 39 — Saved Searches ✅
- [x] `doc/phase-39.md` spec — 2026-05-22
- [x] Schema (SavedSearch + SavedSearchHit models + SAVED_SEARCH_MATCH NotificationKind + relations) — 2026-05-22
- [x] SavedSearchesService (create/list/delete + runOnce/scan, Postgres ILIKE match, one summary notification per scan) + env-gated scheduler — 2026-05-22
- [x] Endpoints: /saved-searches/* + /admin/saved-searches/scan; SavedSearchesApi — 2026-05-22
- [x] Frontend: buyer-web SaveSearchButton on /search + /account/saved-searches + account tile — 2026-05-22
- [x] `doc/phase-39-debug.md` — 2026-05-22

## Phase 40 — Storewide Announcements ✅
- [x] `doc/phase-40.md` spec — 2026-05-22
- [x] Schema (Announcement + AnnouncementDismissal + AnnouncementLevel enum + relations) — 2026-05-22
- [x] AnnouncementsService (currentActive, dismiss with localStorage/server fallback, admin CRUD) + 3 controllers (public/buyer/admin) — 2026-05-22
- [x] AnnouncementsApi; buyer-web AnnouncementBar in root layout; admin-web /announcements page + nav — 2026-05-22
- [x] `doc/phase-40-debug.md` — 2026-05-22
