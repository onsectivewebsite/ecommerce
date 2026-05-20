export type PayoutStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED';
export type PayoutMethod = 'STRIPE_CONNECT' | 'MANUAL';

export interface PayoutDto {
  id: string;
  sellerId: string;
  amountMinor: number;
  currency: string;
  method: PayoutMethod;
  status: PayoutStatus;
  externalRef: string | null;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  createdAt: string;
}

export interface PlatformRevenueDto {
  rangeDays: number;
  since: string;
  currency: string;
  gmvMinor: number;
  commissionMinor: number;
  adRevenueMinor: number;
  takeRateBps: number;
  orderCount: number;
  sellerPayableTotalMinor: number;
  payoutsSentTotalMinor: number;
}
