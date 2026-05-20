import { OnsectiveClient } from '../client';

export type MembershipPlan = 'PLUS_MONTHLY' | 'PLUS_ANNUAL';
export type MembershipStatus = 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PAUSED';

export interface PlusMembership {
  id: string;
  userId: string;
  plan: MembershipPlan;
  status: MembershipStatus;
  startedAt: string;
  expiresAt: string;
  renewedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  pricePaidMinor: number;
  currency: string;
  paymentRef: string | null;
  providerSubscriptionId: string | null;
  autoRenew: boolean;
  currentPeriodEnd: string | null;
}

export interface MembershipBenefits {
  freeShipping: boolean;
  extendedWarrantyMonths: number;
  earlyOutletAccess: boolean;
  pointsMultiplier: number;
}

export interface MembershipResponse {
  membership: PlusMembership | null;
  benefits: MembershipBenefits;
}

export type PointsTransactionKind =
  | 'EARN_PURCHASE'
  | 'EARN_REFURB'
  | 'EARN_TRADEIN'
  | 'EARN_REPAIR'
  | 'EARN_BONUS'
  | 'REDEEM_WALLET'
  | 'ADJUST';

export interface PointsTransactionRow {
  id: string;
  amount: number;
  balanceAfter: number;
  kind: PointsTransactionKind;
  reason: string | null;
  referenceKey: string | null;
  orderId: string | null;
  createdAt: string;
}

export interface PointsStatement {
  balance: number;
  transactions: PointsTransactionRow[];
}

export class LoyaltyApi {
  constructor(private readonly client: OnsectiveClient) {}

  // --- membership ---
  myMembership() {
    return this.client.request<MembershipResponse>('/loyalty/membership/me');
  }
  startMembership(body: { plan: MembershipPlan }) {
    return this.client.request<PlusMembership>('/loyalty/membership', {
      method: 'POST',
      body,
    });
  }
  cancelMembership(body?: { reason?: string }) {
    return this.client.request<PlusMembership>('/loyalty/membership/cancel', {
      method: 'POST',
      body: body ?? {},
    });
  }
  setAutoRenew(autoRenew: boolean) {
    return this.client.request<PlusMembership>('/loyalty/membership/auto-renew', {
      method: 'POST',
      body: { autoRenew },
    });
  }

  // --- points ---
  pointsBalance() {
    return this.client.request<{ balance: number }>('/loyalty/points/balance');
  }
  pointsStatement() {
    return this.client.request<PointsStatement>('/loyalty/points/statement');
  }
  redeemPoints(body: { points: number }) {
    return this.client.request<{ pointsBalance: number; walletCreditedMinor: number }>(
      '/loyalty/points/redeem',
      { method: 'POST', body },
    );
  }
}
