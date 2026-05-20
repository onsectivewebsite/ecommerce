import { OnsectiveClient } from '../client';

export interface InboundItemRow {
  id: string;
  variantId: string;
  expectedQty: number;
  receivedQty: number;
  discrepancyQty: number;
}

export interface InboundShipmentRow {
  id: string;
  sellerId: string;
  warehouseId: string;
  status: 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';
  carrierCode: string | null;
  trackingNumber: string | null;
  note: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  items: InboundItemRow[];
  warehouse?: { code: string; displayName: string };
}

export interface CreateInboundPayload {
  warehouseId: string;
  carrierCode?: string;
  trackingNumber?: string;
  note?: string;
  items: Array<{ variantId: string; expectedQty: number }>;
}

export class InboundApi {
  constructor(private readonly client: OnsectiveClient) {}

  // ---- seller ----
  list(status?: string) {
    return this.client.request<InboundShipmentRow[]>('/seller/inbound', { query: { status } });
  }
  create(body: CreateInboundPayload) {
    return this.client.request<InboundShipmentRow>('/seller/inbound', { method: 'POST', body });
  }
  ship(id: string, body: { carrierCode: string; trackingNumber: string }) {
    return this.client.request<InboundShipmentRow>(`/seller/inbound/${id}/ship`, { method: 'POST', body });
  }
  cancel(id: string) {
    return this.client.request<InboundShipmentRow>(`/seller/inbound/${id}/cancel`, { method: 'POST' });
  }

  // ---- warehouse-staff ----
  listAtWarehouse(warehouseId: string, status?: string) {
    return this.client.request<InboundShipmentRow[]>(`/warehouse/${warehouseId}/inbound`, { query: { status } });
  }
  receive(warehouseId: string, id: string, lines: Array<{ variantId: string; receivedQty: number; discrepancyQty?: number }>) {
    return this.client.request<InboundShipmentRow>(`/warehouse/${warehouseId}/inbound/${id}/receive`, {
      method: 'POST', body: { lines },
    });
  }
  close(warehouseId: string, id: string) {
    return this.client.request<InboundShipmentRow>(`/warehouse/${warehouseId}/inbound/${id}/close`, { method: 'POST' });
  }
}

export interface PickListRow {
  orderItemId: string;
  orderId: string;
  orderShort: string;
  sku: string;
  productTitle: string;
  variantName: string;
  qty: number;
  binLocation: string | null;
  shipTo: string;
  pickedAt: string | null;
}

export class PickListApi {
  constructor(private readonly client: OnsectiveClient) {}

  summary(warehouseId: string) {
    return this.client.request<{ id: string; code: string; displayName: string; country: string; region: string; city: string }>(
      `/warehouse/${warehouseId}/summary`,
    );
  }
  list(warehouseId: string) {
    return this.client.request<PickListRow[]>(`/warehouse/${warehouseId}/pick-list`);
  }
}
