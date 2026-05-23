'use client';

import {
  AdminApi,
  AiVisionApi,
  RepairNetworkApi,
  ReturnsDispositionApi,
  SlaApi,
  SustainabilityApi,
  AuthApi,
  AuthenticityApi,
  BrandsApi,
  CatalogApi,
  CertificationsApi,
  ComplianceApi,
  AdminGiftCardsApi,
  DisputesApi,
  OnsectiveClient,
  PayoutsApi,
  PlusAdminApi,
  AdminPrivacyApi,
  AdminRateLimitsApi,
  AdminReferralsApi,
  AdminSellerConnectApi,
  PromotionsApi,
  ReturnsApi,
  ReviewsApi,
  QnaApi,
  AnnouncementsApi,
  RevenueApi,
  RiskApi,
  SellerHealthApi,
  ShippingApi,
  SupportApi,
  WalletApi,
  TradeInApi,
  WarehousesApi,
  WarrantyApi,
} from '@onsective/api-client';
import { PUBLIC_API_URL } from './env';

let accessToken: string | null = null;
export function setAccessToken(t: string | null) { accessToken = t; }
export function getAccessToken() { return accessToken; }

let refreshing: Promise<string | null> | null = null;
async function attemptRefresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch(`${PUBLIC_API_URL}/auth/refresh`, {
        method: 'POST', credentials: 'include', headers: { 'X-Refresh': '1' },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return accessToken;
    } catch { return null; }
    finally { refreshing = null; }
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
  admin: new AdminApi(client),
  shipping: new ShippingApi(client),
  payouts: new PayoutsApi(client),
  revenue: new RevenueApi(client),
  compliance: new ComplianceApi(client),
  catalog: new CatalogApi(client),
  returns: new ReturnsApi(client),
  reviews: new ReviewsApi(client),
  qna: new QnaApi(client),
  announcements: new AnnouncementsApi(client),
  disputes: new DisputesApi(client),
  support: new SupportApi(client),
  promotions: new PromotionsApi(client),
  wallet: new WalletApi(client),
  risk: new RiskApi(client),
  sellerHealth: new SellerHealthApi(client),
  warehouses: new WarehousesApi(client),
  brands: new BrandsApi(client),
  certifications: new CertificationsApi(client),
  warranty: new WarrantyApi(client),
  authenticity: new AuthenticityApi(client),
  tradeIn: new TradeInApi(client),
  aiVision: new AiVisionApi(client),
  returnsDisposition: new ReturnsDispositionApi(client),
  repairNetwork: new RepairNetworkApi(client),
  sustainability: new SustainabilityApi(client),
  sla: new SlaApi(client),
  plusAdmin: new PlusAdminApi(client),
  referralsAdmin: new AdminReferralsApi(client),
  privacyAdmin: new AdminPrivacyApi(client),
  sellerConnect: new AdminSellerConnectApi(client),
  rateLimits: new AdminRateLimitsApi(client),
  giftCards: new AdminGiftCardsApi(client),
};
