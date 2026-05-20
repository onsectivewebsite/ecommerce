import { OnsectiveClient } from '../client';

export type DisputeKind = 'RETURN' | 'MISSING_DELIVERY' | 'CHARGEBACK' | 'OTHER';
export type DisputeStatus = 'OPEN' | 'RESOLVED_BUYER' | 'RESOLVED_SELLER' | 'RESOLVED_SPLIT' | 'CLOSED_NO_ACTION';

export interface DisputeRow {
  id: string;
  kind: DisputeKind;
  status: DisputeStatus;
  threadId: string | null;
  returnId: string | null;
  shipmentId: string | null;
  paymentId: string | null;
  openedByUserId: string | null;
  assignedAdminId: string | null;
  resolutionNote: string | null;
  resolutionMinor: number;
  openedAt: string;
  resolvedAt: string | null;
}

export class DisputesApi {
  constructor(private readonly client: OnsectiveClient) {}

  open(body: { kind: DisputeKind; orderId: string; reason: string }) {
    return this.client.request<DisputeRow>('/disputes', { method: 'POST', body });
  }

  // ---- admin ----
  adminList(query?: { status?: DisputeStatus; kind?: DisputeKind; assignedTo?: string }) {
    return this.client.request<DisputeRow[]>('/admin/disputes', { query });
  }
  adminGet(id: string) {
    return this.client.request<DisputeRow>(`/admin/disputes/${id}`);
  }
  assign(id: string, body: { adminUserId: string }) {
    return this.client.request<DisputeRow>(`/admin/disputes/${id}/assign`, { method: 'POST', body });
  }
  resolve(id: string, body: {
    outcome: 'RESOLVED_BUYER' | 'RESOLVED_SELLER' | 'RESOLVED_SPLIT' | 'CLOSED_NO_ACTION';
    note: string;
    resolutionMinor?: number;
  }) {
    return this.client.request<{ dispute: DisputeRow; refund: { providerRefundId?: string; full?: boolean } | null }>(
      `/admin/disputes/${id}/resolve`, { method: 'POST', body },
    );
  }
}
