import { OnsectiveClient } from '../client';

export type AdminPlusPlan = 'PLUS_MONTHLY' | 'PLUS_ANNUAL';
export type AdminBillingEventKind =
  | 'INVOICE_PAID'
  | 'INVOICE_FAILED'
  | 'SUB_UPDATED'
  | 'SUB_DELETED'
  | 'NOTICE_SENT';

export interface AdminPlusStats {
  activeCount: number;
  pausedCount: number;
  mrrMinor: number;
  newLast30dByPlan: Record<AdminPlusPlan, number>;
  churnedLast30dByPlan: Record<AdminPlusPlan, number>;
  asOf: string;
}

export interface AdminPlusBillingEvent {
  id: string;
  kind: AdminBillingEventKind;
  amountMinor: number | null;
  currency: string | null;
  reason: string | null;
  createdAt: string;
  membership: {
    id: string;
    plan: AdminPlusPlan;
    userEmail: string;
    userName: string;
  };
}

export class PlusAdminApi {
  constructor(private readonly client: OnsectiveClient) {}

  stats() {
    return this.client.request<AdminPlusStats>('/admin/plus/stats');
  }
  events(params?: { limit?: number; kind?: AdminBillingEventKind }) {
    return this.client.request<AdminPlusBillingEvent[]>('/admin/plus/billing-events', {
      query: params,
    });
  }
  scanExpiring() {
    return this.client.request<{ scanned: number; emailed: number; skippedAlreadySent: number }>(
      '/admin/plus/scan-expiring',
      { method: 'POST' },
    );
  }
}
