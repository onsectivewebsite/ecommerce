import { OnsectiveClient } from '../client';

export type PromotionKind = 'PERCENT_OFF' | 'AMOUNT_OFF' | 'FREE_SHIPPING' | 'BOGO';
export type PromotionScope = 'SELLER' | 'PLATFORM';
export type PromotionStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface PromotionRow {
  id: string;
  code: string;
  kind: PromotionKind;
  scope: PromotionScope;
  status: PromotionStatus;
  sellerId: string | null;
  valueBpOrMinor: number;
  currency: string | null;
  minSubtotalMinor: number;
  bogoBuyQty: number | null;
  bogoGetQty: number | null;
  bogoGetDiscountBp: number | null;
  perUserLimit: number | null;
  totalLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  notes: string | null;
  createdAt: string;
  _count?: { redemptions: number };
}

export interface CreatePromotionPayload {
  code: string;
  kind: PromotionKind;
  scope: PromotionScope;
  valueBpOrMinor: number;
  currency?: string;
  minSubtotalMinor?: number;
  bogoBuyQty?: number;
  bogoGetQty?: number;
  bogoGetDiscountBp?: number;
  perUserLimit?: number;
  totalLimit?: number;
  startsAt?: string;
  endsAt?: string;
  notes?: string;
  productIds?: string[];
}

export class PromotionsApi {
  constructor(private readonly client: OnsectiveClient) {}

  // ---- seller ----
  listForSeller() {
    return this.client.request<PromotionRow[]>('/seller/promotions');
  }
  createForSeller(body: CreatePromotionPayload) {
    return this.client.request<PromotionRow>('/seller/promotions', { method: 'POST', body });
  }
  updateForSeller(id: string, body: Partial<CreatePromotionPayload> & { status?: PromotionStatus }) {
    return this.client.request<PromotionRow>(`/seller/promotions/${id}`, { method: 'PATCH', body });
  }

  // ---- admin ----
  adminList(scope?: PromotionScope) {
    return this.client.request<PromotionRow[]>('/admin/promotions', { query: { scope } });
  }
  adminCreate(body: CreatePromotionPayload) {
    return this.client.request<PromotionRow>('/admin/promotions', { method: 'POST', body });
  }
  adminUpdate(id: string, body: Partial<CreatePromotionPayload> & { status?: PromotionStatus }) {
    return this.client.request<PromotionRow>(`/admin/promotions/${id}`, { method: 'PATCH', body });
  }
}
