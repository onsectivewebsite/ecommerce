'use client';

import {
  AdsApi,
  AuthApi,
  BrandsApi,
  CatalogApi,
  CertificationsApi,
  ComplianceApi,
  DigitalApi,
  InboundApi,
  InventoryForecastApi,
  MessagingApi,
  OnsectiveClient,
  PayoutsApi,
  PromotionsApi,
  RefurbUnitsApi,
  ReturnsApi,
  ReviewsApi,
  SellerAnalyticsApi,
  SellerApi,
  SellerHealthApi,
  SellerOnboardingApi,
  SellerWebhooksApi,
  StorageApi,
  SubscriptionsApi,
  WarehousesApi,
} from '@onsective/api-client';
import { PUBLIC_API_URL } from './env';

let accessToken: string | null = null;

export function setAccessToken(t: string | null) { accessToken = t; }
export function getAccessToken() { return accessToken; }

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
  seller: new SellerApi(client),
  subscriptions: new SubscriptionsApi(client),
  ads: new AdsApi(client),
  payouts: new PayoutsApi(client),
  compliance: new ComplianceApi(client),
  digital: new DigitalApi(client),
  returns: new ReturnsApi(client),
  reviews: new ReviewsApi(client),
  messaging: new MessagingApi(client),
  promotions: new PromotionsApi(client),
  analytics: new SellerAnalyticsApi(client),
  webhooks: new SellerWebhooksApi(client),
  forecast: new InventoryForecastApi(client),
  health: new SellerHealthApi(client),
  warehouses: new WarehousesApi(client),
  inbound: new InboundApi(client),
  storage: new StorageApi(client),
  brands: new BrandsApi(client),
  certifications: new CertificationsApi(client),
  refurbUnits: new RefurbUnitsApi(client),
  onboarding: new SellerOnboardingApi(client),
};
