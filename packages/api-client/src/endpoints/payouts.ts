import type { PayoutDto, PayoutStatus, PlatformRevenueDto } from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export class PayoutsApi {
  constructor(private readonly client: OnsectiveClient) {}

  // ----- Admin -----

  listAdmin(status?: PayoutStatus) {
    return this.client.request<PayoutDto[]>('/admin/payouts', { query: { status } });
  }

  run() {
    return this.client.request<{ created: number; skipped: number }>('/admin/payouts/run', { method: 'POST' });
  }

  execute(id: string) {
    return this.client.request<PayoutDto>(`/admin/payouts/${id}/execute`, { method: 'POST' });
  }

  markPaid(id: string, externalRef?: string) {
    return this.client.request<PayoutDto>(`/admin/payouts/${id}/mark-paid`, {
      method: 'POST',
      body: externalRef ? { externalRef } : undefined,
    });
  }

  // ----- Seller -----

  mine() {
    return this.client.request<PayoutDto[]>('/seller/payouts');
  }
}

export class RevenueApi {
  constructor(private readonly client: OnsectiveClient) {}

  snapshot(rangeDays = 30) {
    return this.client.request<PlatformRevenueDto>('/admin/revenue', { query: { rangeDays } });
  }
}
