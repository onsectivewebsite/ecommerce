import { OnsectiveClient } from '../client';

export type ReferralCodeStatus = 'ACTIVE' | 'DISABLED';
export type ReferralRejectionReason =
  | 'NO_SUCH_CODE'
  | 'CODE_DISABLED'
  | 'SELF_REDEMPTION'
  | 'SAME_ADDRESS'
  | 'SAME_IP'
  | 'LIMIT_REACHED'
  | 'ALREADY_REDEEMED';

export interface ReferralRedemptionRow {
  id: string;
  inviteeFirstName: string;
  inviteeInitial: string;
  pointsAwarded: number;
  createdAt: string;
}

export interface ReferralMe {
  code: string;
  status: ReferralCodeStatus;
  totalRedemptions: number;
  inviterRewardPoints: number;
  inviteeRewardPoints: number;
  redemptions: ReferralRedemptionRow[];
}

export interface ReferralAbuseEvent {
  id: string;
  attemptedCode: string;
  attemptedUserId: string | null;
  reason: ReferralRejectionReason;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface ReferralTopInviter {
  userId: string;
  email: string;
  name: string;
  redemptions: number;
}

export class ReferralsApi {
  constructor(private readonly client: OnsectiveClient) {}

  me() {
    return this.client.request<ReferralMe>('/referrals/me');
  }
}

export class AdminReferralsApi {
  constructor(private readonly client: OnsectiveClient) {}

  topInviters(days?: number) {
    return this.client.request<ReferralTopInviter[]>('/admin/referrals/top-inviters', {
      query: { days },
    });
  }
  abuseEvents(limit?: number) {
    return this.client.request<ReferralAbuseEvent[]>('/admin/referrals/abuse-events', {
      query: { limit },
    });
  }
  disable(code: string) {
    return this.client.request<{ id: string; code: string; status: ReferralCodeStatus }>(
      `/admin/referrals/${encodeURIComponent(code)}/disable`,
      { method: 'POST' },
    );
  }
}
