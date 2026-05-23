'use client';

import {
  AdminApi,
  AdsApi,
  AuthApi,
  BrandsApi,
  CartApi,
  CatalogApi,
  ComplianceApi,
  DigitalApi,
  DisputesApi,
  ExperimentsApi,
  FxApi,
  GiftCardsApi,
  LoyaltyApi,
  MessagingApi,
  NotificationFeedApi,
  OnsectiveClient,
  PaymentMethodsApi,
  PrivacyApi,
  ReferralsApi,
  OrdersApi,
  PreferencesApi,
  PromotionsApi,
  RecommendationsApi,
  OutletApi,
  RefurbUnitsApi,
  RepairNetworkApi,
  SlaApi,
  SustainabilityApi,
  ReturnsApi,
  ReviewsApi,
  QnaApi,
  AutoshipApi,
  ComparisonApi,
  SearchApi,
  SecurityApi,
  SellerApi,
  ShippingApi,
  TradeInApi,
  UsersApi,
  WalletApi,
  WarrantyApi,
  WishlistsApi,
} from '@onsective/api-client';
import { PUBLIC_API_URL } from './env';

let accessToken: string | null = null;

export function setAccessToken(t: string | null) {
  accessToken = t;
}

export function getAccessToken() {
  return accessToken;
}

let refreshing: Promise<string | null> | null = null;

async function attemptRefresh(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch(`${PUBLIC_API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Refresh': '1' },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return accessToken;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

const client = new OnsectiveClient({
  baseUrl: PUBLIC_API_URL,
  credentials: 'include',
  getAccessToken: () => accessToken,
  onUnauthorized: () => attemptRefresh(),
});

export const api = {
  auth: new AuthApi(client),
  catalog: new CatalogApi(client),
  cart: new CartApi(client),
  orders: new OrdersApi(client),
  seller: new SellerApi(client),
  admin: new AdminApi(client),
  shipping: new ShippingApi(client),
  ads: new AdsApi(client),
  compliance: new ComplianceApi(client),
  digital: new DigitalApi(client),
  fx: new FxApi(client),
  users: new UsersApi(client),
  search: new SearchApi(client),
  recommendations: new RecommendationsApi(client),
  experiments: new ExperimentsApi(client),
  returns: new ReturnsApi(client),
  reviews: new ReviewsApi(client),
  qna: new QnaApi(client),
  autoship: new AutoshipApi(client),
  comparison: new ComparisonApi(client),
  messaging: new MessagingApi(client),
  disputes: new DisputesApi(client),
  wallet: new WalletApi(client),
  wishlists: new WishlistsApi(client),
  promotions: new PromotionsApi(client),
  preferences: new PreferencesApi(client),
  security: new SecurityApi(client),
  brands: new BrandsApi(client),
  refurbUnits: new RefurbUnitsApi(client),
  warranty: new WarrantyApi(client),
  tradeIn: new TradeInApi(client),
  outlet: new OutletApi(client),
  repair: new RepairNetworkApi(client),
  sustainability: new SustainabilityApi(client),
  sla: new SlaApi(client),
  loyalty: new LoyaltyApi(client),
  paymentMethods: new PaymentMethodsApi(client),
  referrals: new ReferralsApi(client),
  privacy: new PrivacyApi(client),
  inbox: new NotificationFeedApi(client),
  giftCards: new GiftCardsApi(client),
};
