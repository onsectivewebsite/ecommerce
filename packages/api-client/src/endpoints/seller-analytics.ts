import { OnsectiveClient } from '../client';

export interface SellerAnalyticsOverview {
  windowDays: number;
  orderCount: number;
  funnel: {
    VIEW: number;
    ADD_TO_CART: number;
    PURCHASE: number;
    viewToAddRate: number;
    addToPurchaseRate: number;
    overallConversion: number;
  };
  topProducts: Array<{
    productId: string;
    title: string;
    slug: string;
    currency: string;
    purchases: number;
    revenueMinor: number;
  }>;
  aovTrend: Array<{ date: string; orders: number; revenueMinor: number; aovMinor: number }>;
  returnRateBySku: Array<{
    productId: string;
    title: string;
    slug: string;
    purchases: number;
    returns: number;
    returnRate: number;
  }>;
}

export class SellerAnalyticsApi {
  constructor(private readonly client: OnsectiveClient) {}

  overview(days = 30) {
    return this.client.request<SellerAnalyticsOverview>('/seller/analytics/overview', { query: { days } });
  }
}
