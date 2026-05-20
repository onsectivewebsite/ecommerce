import { OnsectiveClient } from '../client';

export type ConnectAccountStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'RESTRICTED'
  | 'ENABLED'
  | 'REJECTED'
  | 'DISABLED';

export interface ConnectStatus {
  sellerId: string;
  status: ConnectAccountStatus;
  payoutsEnabled: boolean;
  stripeConnectId: string | null;
  requirementsDue: string[];
  onboardedAt: string | null;
  lastSyncedAt: string | null;
}

export class SellerOnboardingApi {
  constructor(private readonly client: OnsectiveClient) {}

  status() {
    return this.client.request<ConnectStatus>('/seller/onboarding/payouts/status');
  }
  start() {
    return this.client.request<{ url: string; expiresAt: string }>(
      '/seller/onboarding/payouts/start',
      { method: 'POST' },
    );
  }
  loginLink() {
    return this.client.request<{ url: string }>(
      '/seller/onboarding/payouts/login-link',
      { method: 'POST' },
    );
  }
  sync() {
    return this.client.request<ConnectStatus>('/seller/onboarding/payouts/sync', {
      method: 'POST',
    });
  }
}

export class AdminSellerConnectApi {
  constructor(private readonly client: OnsectiveClient) {}

  details(sellerId: string) {
    return this.client.request<ConnectStatus | null>(
      `/admin/sellers/${encodeURIComponent(sellerId)}/connect`,
    );
  }
  forceSync(sellerId: string) {
    return this.client.request<ConnectStatus | null>(
      `/admin/sellers/${encodeURIComponent(sellerId)}/connect/sync`,
      { method: 'POST' },
    );
  }
  disable(sellerId: string) {
    return this.client.request<{ id: string }>(
      `/admin/sellers/${encodeURIComponent(sellerId)}/connect/disable`,
      { method: 'POST' },
    );
  }
}
