import { OnsectiveClient } from '../client';

export interface HealthSnapshot {
  id: string;
  sellerId: string;
  score: number;
  disputeRate: number;
  chargebackRate: number;
  returnRate: number;
  slaBreachRate: number;
  ordersConsidered: number;
  windowDays: number;
  reasons: string[];
  capturedAt: string;
}

export interface SellerHealthOverview {
  sellerStatus: string;
  latest: HealthSnapshot | null;
  trend: Array<{ date: string; score: number }>;
}

export class SellerHealthApi {
  constructor(private readonly client: OnsectiveClient) {}

  mine() {
    return this.client.request<SellerHealthOverview>('/seller/health');
  }
  adminList(maxScore?: number) {
    return this.client.request<Array<HealthSnapshot & { seller: { displayName: string; status: string } }>>(
      '/admin/seller-health', { query: { maxScore } },
    );
  }
}
