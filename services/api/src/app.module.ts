import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { SellerModule } from './modules/seller/seller.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AdminModule } from './modules/admin/admin.module';
import { SettingsModule } from './modules/settings/settings.module';
import { MediaModule } from './modules/media/media.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { AuditModule } from './modules/audit/audit.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { ListingFeesModule } from './modules/listing-fees/listing-fees.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { AdsModule } from './modules/ads/ads.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { DigitalGoodsModule } from './modules/digital-goods/digital-goods.module';
import { FxModule } from './modules/fx/fx.module';
import { TaxModule } from './modules/tax/tax.module';
import { I18nModule } from './modules/i18n/i18n.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SearchModule } from './modules/search/search.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { ExperimentsModule } from './modules/experiments/experiments.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { QnaModule } from './modules/qna/qna.module';
import { AutoshipModule } from './modules/autoship/autoship.module';
import { ComparisonModule } from './modules/comparison/comparison.module';
import { SavedSearchesModule } from './modules/saved-searches/saved-searches.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { SupportModule } from './modules/support/support.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { WishlistsModule } from './modules/wishlists/wishlists.module';
import { AbandonedCartModule } from './modules/abandoned-cart/abandoned-cart.module';
import { EmailModule } from './modules/email/email.module';
import { SellerAnalyticsModule } from './modules/seller-analytics/seller-analytics.module';
import { InventoryForecastModule } from './modules/inventory-forecast/inventory-forecast.module';
import { SellerWebhooksModule } from './modules/seller-webhooks/seller-webhooks.module';
import { RiskModule } from './modules/risk/risk.module';
import { SecurityModule } from './modules/security/security.module';
import { SellerHealthModule } from './modules/seller-health/seller-health.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module';
import { BrandsModule } from './modules/brands/brands.module';
import { SellerCertificationsModule } from './modules/seller-certifications/seller-certifications.module';
import { RefurbUnitsModule } from './modules/refurb-units/refurb-units.module';
import { AuthenticityModule } from './modules/authenticity/authenticity.module';
import { WarrantyModule } from './modules/warranty/warranty.module';
import { TradeInModule } from './modules/trade-in/trade-in.module';
import { AiVisionModule } from './modules/ai-vision/ai-vision.module';
import { ReturnsDispositionModule } from './modules/returns-disposition/returns-disposition.module';
import { RepairNetworkModule } from './modules/repair-network/repair-network.module';
import { SustainabilityModule } from './modules/sustainability/sustainability.module';
import { SlaModule } from './modules/sla/sla.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { NotificationFeedModule } from './modules/notification-feed/notification-feed.module';
import { SeoModule } from './modules/seo/seo.module';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import { TwoFactorModule } from './modules/two-factor/two-factor.module';
import { WebAuthnModule } from './modules/webauthn/webauthn.module';
import { RecoveryModule } from './modules/recovery/recovery.module';
import { GiftCardsModule } from './modules/gift-cards/gift-cards.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot({ wildcard: false }),
    PrismaModule,
    SettingsModule,
    MediaModule,
    AuditModule,
    InventoryModule,
    LedgerModule,
    HealthModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    SubscriptionsModule,
    ListingFeesModule,
    ComplianceModule,
    DigitalGoodsModule,
    FxModule,
    TaxModule,
    I18nModule,
    NotificationsModule,
    SearchModule,
    RecommendationsModule,
    ExperimentsModule,
    SellerModule,
    CartModule,
    ShippingModule,
    OrdersModule,
    PaymentsModule,
    AdsModule,
    PayoutsModule,
    PromotionsModule,
    WalletModule,
    ReturnsModule,
    ReviewsModule,
    QnaModule,
    AutoshipModule,
    ComparisonModule,
    SavedSearchesModule,
    MessagingModule,
    DisputesModule,
    SupportModule,
    WishlistsModule,
    AbandonedCartModule,
    EmailModule,
    SellerAnalyticsModule,
    InventoryForecastModule,
    SellerWebhooksModule,
    ObservabilityModule,
    SecurityModule,
    RiskModule,
    SellerHealthModule,
    FulfillmentModule,
    BrandsModule,
    SellerCertificationsModule,
    RefurbUnitsModule,
    AuthenticityModule,
    WarrantyModule,
    TradeInModule,
    AiVisionModule,
    ReturnsDispositionModule,
    RepairNetworkModule,
    SustainabilityModule,
    SlaModule,
    LoyaltyModule,
    ReferralsModule,
    PrivacyModule,
    NotificationFeedModule,
    SeoModule,
    RateLimitModule,
    TwoFactorModule,
    WebAuthnModule,
    RecoveryModule,
    GiftCardsModule,
    AdminModule,

  ],
})
export class AppModule {}
