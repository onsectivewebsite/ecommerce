import { OnsectiveClient } from '../client';

export interface ReturnItemInput {
  orderItemId: string;
  quantity: number;
}

export interface RequestReturnPayload {
  orderId: string;
  reason: string;
  buyerNote?: string;
  photoBase64?: string;
  items: ReturnItemInput[];
}

export interface ReturnRow {
  id: string;
  orderId: string;
  status: string;
  reason: string;
  buyerNote: string | null;
  sellerNote: string | null;
  returnCarrierCode: string | null;
  returnTrackingNumber: string | null;
  returnLabelObjectKey: string | null;
  returnPublicToken: string | null;
  refundAmountMinor: number;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items?: Array<{ id: string; orderItemId: string; quantity: number }>;
}

export interface PresignedLabel {
  url: string;
  expiresInSec: number;
}

export class ReturnsApi {
  constructor(private readonly client: OnsectiveClient) {}

  // ---- buyer ----
  request(body: RequestReturnPayload) {
    return this.client.request<ReturnRow>('/returns', { method: 'POST', body });
  }
  mine() {
    return this.client.request<ReturnRow[]>('/returns/mine');
  }
  cancel(returnId: string) {
    return this.client.request<ReturnRow>(`/returns/${returnId}`, { method: 'DELETE' });
  }
  labelUrl(returnId: string) {
    return this.client.request<PresignedLabel>(`/returns/${returnId}/label`);
  }
  markDropped(returnId: string) {
    return this.client.request<ReturnRow>(`/returns/${returnId}/dropoff`, { method: 'POST' });
  }

  // ---- seller ----
  listForSeller() {
    return this.client.request<ReturnRow[]>('/seller/returns');
  }
  approve(returnId: string, body: { refundAmountMinor?: number; sellerNote?: string } = {}) {
    return this.client.request<ReturnRow>(`/seller/returns/${returnId}/approve`, { method: 'POST', body });
  }
  reject(returnId: string, body: { sellerNote: string }) {
    return this.client.request<ReturnRow>(`/seller/returns/${returnId}/reject`, { method: 'POST', body });
  }
  markReceived(returnId: string) {
    return this.client.request<ReturnRow>(`/seller/returns/${returnId}/received`, { method: 'POST' });
  }

  // ---- admin ----
  adminList(status?: string) {
    return this.client.request<ReturnRow[]>('/admin/returns', { query: { status } });
  }
  adminForceRefund(returnId: string) {
    return this.client.request<ReturnRow>(`/admin/returns/${returnId}/force-refund`, { method: 'POST' });
  }
}
