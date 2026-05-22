import { OnsectiveClient } from '../client';

export type AutoshipStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';

export interface ProductSubscriptionRow {
  id: string;
  status: AutoshipStatus;
  qty: number;
  intervalDays: number;
  discountBps: number;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  failureCount: number;
  skipNextRun: boolean;
  shippingAddressId: string;
  createdAt: string;
  variantId: string;
  variantName: string;
  unitPriceMinor: number;
  discountedUnitMinor: number;
  currency: string;
  product: { slug: string; title: string };
}

export class AutoshipApi {
  constructor(private readonly client: OnsectiveClient) {}

  subscribe(body: { variantId: string; qty: number; intervalDays: number; shippingAddressId: string }) {
    return this.client.request<ProductSubscriptionRow>('/autoship', { method: 'POST', body });
  }
  list() {
    return this.client.request<ProductSubscriptionRow[]>('/autoship');
  }
  get(id: string) {
    return this.client.request<ProductSubscriptionRow>(`/autoship/${id}`);
  }
  update(id: string, body: { qty?: number; intervalDays?: number; shippingAddressId?: string }) {
    return this.client.request<ProductSubscriptionRow>(`/autoship/${id}`, { method: 'PATCH', body });
  }
  skip(id: string) {
    return this.client.request<ProductSubscriptionRow>(`/autoship/${id}/skip`, { method: 'POST' });
  }
  pause(id: string) {
    return this.client.request<ProductSubscriptionRow>(`/autoship/${id}/pause`, { method: 'POST' });
  }
  resume(id: string) {
    return this.client.request<ProductSubscriptionRow>(`/autoship/${id}/resume`, { method: 'POST' });
  }
  cancel(id: string) {
    return this.client.request<ProductSubscriptionRow>(`/autoship/${id}/cancel`, { method: 'POST' });
  }
}
