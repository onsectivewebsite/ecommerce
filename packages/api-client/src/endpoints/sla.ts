import { OnsectiveClient } from '../client';

export type SlaBreachKind = 'SHIP' | 'DELIVER';

export interface SlaProfileRow {
  id: string;
  warehouseId: string;
  country: string;
  region: string | null;
  shipDays: number;
  deliveryDays: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  warehouse?: { id: string; code: string; displayName: string };
}

export interface SlaEstimate {
  warehouseId: string | null;
  shipDays: number | null;
  deliveryDays: number | null;
  shipBy: string | null;
  deliverBy: string | null;
}

export interface SlaBreachRow {
  id: string;
  orderItemId: string;
  kind: SlaBreachKind;
  promisedAt: string;
  detectedAt: string;
  breachHours: number;
  sellerId: string | null;
  createdAt: string;
  orderItem?: { id: string; productTitleSnapshot: string; orderId: string };
}

export interface UpsertSlaProfilePayload {
  warehouseId: string;
  country: string;
  region?: string;
  shipDays: number;
  deliveryDays: number;
  notes?: string;
}

export class SlaApi {
  constructor(private readonly client: OnsectiveClient) {}

  estimate(params: { productId: string; country: string; region?: string; qty?: number }) {
    return this.client.request<SlaEstimate>('/sla/estimate', { query: params });
  }

  adminListProfiles(warehouseId?: string) {
    return this.client.request<SlaProfileRow[]>('/admin/sla/profiles', { query: { warehouseId } });
  }
  adminUpsertProfile(body: UpsertSlaProfilePayload) {
    return this.client.request<SlaProfileRow>('/admin/sla/profiles', { method: 'POST', body });
  }
  adminDeleteProfile(id: string) {
    return this.client.request<{ ok: boolean }>(`/admin/sla/profiles/${id}`, { method: 'DELETE' });
  }
  adminBreaches(limit?: number) {
    return this.client.request<SlaBreachRow[]>('/admin/sla/breaches', { query: { limit } });
  }
  adminScan() {
    return this.client.request<{ shipBreaches: number; deliverBreaches: number }>('/admin/sla/scan', {
      method: 'POST',
    });
  }
}
