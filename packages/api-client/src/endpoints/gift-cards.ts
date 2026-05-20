import { OnsectiveClient } from '../client';

export type GiftCardStatus =
  | 'PENDING_PAYMENT'
  | 'ACTIVE'
  | 'REDEEMED'
  | 'VOID'
  | 'EXPIRED';

export interface GiftCardRow {
  id: string;
  code: string;
  status: GiftCardStatus;
  currency: string;
  initialAmountMinor: number;
  balanceMinor: number;
  recipientEmail: string;
  recipientName: string | null;
  senderName: string | null;
  message: string | null;
  deliverAt: string | null;
  deliveredAt: string | null;
  redeemedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface GiftCardCheck {
  status: GiftCardStatus;
  balanceMinor: number;
  currency: string;
  expiresAt: string | null;
  redeemable: boolean;
}

export interface PurchaseGiftCardRequest {
  amountMinor: number;
  currency?: string;
  recipientEmail: string;
  recipientName?: string;
  senderName?: string;
  message?: string;
  deliverAt?: string;
  paymentProvider?: 'stripe' | 'mock';
}

export interface PurchaseGiftCardResult {
  giftCardId: string;
  clientSecret: string | null;
  code: string;
}

export interface RedeemGiftCardResult {
  creditedMinor: number;
  currency: string;
  walletBalanceMinor: number;
}

export interface AdminIssueGiftCardRequest {
  amountMinor: number;
  currency?: string;
  recipientEmail: string;
  recipientName?: string;
  senderName?: string;
  message?: string;
  expiresAt?: string;
}

export class GiftCardsApi {
  constructor(private readonly client: OnsectiveClient) {}

  purchase(body: PurchaseGiftCardRequest) {
    return this.client.request<PurchaseGiftCardResult>('/gift-cards/purchase', {
      method: 'POST',
      body,
    });
  }

  check(code: string) {
    return this.client.request<GiftCardCheck>('/gift-cards/check', {
      query: { code },
    });
  }

  redeem(code: string) {
    return this.client.request<RedeemGiftCardResult>('/gift-cards/redeem', {
      method: 'POST',
      body: { code },
    });
  }

  mine() {
    return this.client.request<GiftCardRow[]>('/gift-cards/mine');
  }
}

export class AdminGiftCardsApi {
  constructor(private readonly client: OnsectiveClient) {}

  list(params?: { status?: GiftCardStatus; q?: string }) {
    return this.client.request<GiftCardRow[]>('/admin/gift-cards', { query: params });
  }

  issue(body: AdminIssueGiftCardRequest) {
    return this.client.request<GiftCardRow>('/admin/gift-cards/issue', {
      method: 'POST',
      body,
    });
  }

  void(id: string) {
    return this.client.request<{ ok: true }>(`/admin/gift-cards/${id}/void`, {
      method: 'POST',
    });
  }
}
