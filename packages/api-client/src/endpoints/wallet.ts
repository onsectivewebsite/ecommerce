import { OnsectiveClient } from '../client';

export interface WalletStatement {
  currency: string;
  balanceMinor: number;
  transactions: Array<{
    id: string;
    kind: string;
    amountMinor: number;
    balanceAfterMinor: number;
    reason: string | null;
    orderId: string | null;
    returnId: string | null;
    createdAt: string;
  }>;
}

export class WalletApi {
  constructor(private readonly client: OnsectiveClient) {}

  statement() {
    return this.client.request<WalletStatement>('/wallet');
  }

  adminGrant(body: { targetUserId: string; amountMinor: number; reason: string; currency?: string }) {
    return this.client.request<{ newBalance: number }>('/admin/wallet/grant', { method: 'POST', body });
  }
}
