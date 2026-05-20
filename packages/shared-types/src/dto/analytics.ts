export type AnalyticsRange = '7d' | '30d' | '90d';

export interface AnalyticsSummaryDto {
  range: AnalyticsRange;
  since: string;
  currency: string;
  orderCount: number;
  grossMinor: number;
  netSellerMinor: number;
  commissionMinor: number;
  aovMinor: number;
  refundedCount: number;
}

export interface TopSkuDto {
  variantId: string;
  sku: string;
  productTitle: string;
  variantName: string;
  unitsSold: number;
  revenueMinor: number;
}
