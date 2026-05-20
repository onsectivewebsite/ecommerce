import { OnsectiveClient } from '../client';

export interface RiskRuleHitRow {
  id: string;
  code: string;
  score: number;
  reason: string;
  details: Record<string, unknown>;
}

export interface RiskAssessmentRow {
  id: string;
  orderId: string;
  score: number;
  decision: 'ALLOW' | 'HOLD' | 'BLOCK';
  hitCount: number;
  hits: RiskRuleHitRow[];
  order: {
    id: string;
    userId: string;
    totalMinor: number;
    currency: string;
    status: string;
  };
}

export interface OrderHoldRow {
  id: string;
  orderId: string;
  reason: string;
  status: 'OPEN' | 'RELEASED' | 'CANCELLED';
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  order: {
    id: string;
    userId: string;
    sellerId: string;
    totalMinor: number;
    currency: string;
    status: string;
    riskAssessment: RiskAssessmentRow | null;
  };
}

export class RiskApi {
  constructor(private readonly client: OnsectiveClient) {}

  queue() {
    return this.client.request<OrderHoldRow[]>('/admin/risk/queue');
  }
  assessment(orderId: string) {
    return this.client.request<RiskAssessmentRow>(`/admin/risk/orders/${orderId}`);
  }
  release(orderId: string, note: string) {
    return this.client.request<{ ok: boolean }>(`/admin/risk/orders/${orderId}/release`, {
      method: 'POST', body: { note },
    });
  }
  cancel(orderId: string, note: string) {
    return this.client.request<{ ok: boolean }>(`/admin/risk/orders/${orderId}/cancel`, {
      method: 'POST', body: { note },
    });
  }
}
