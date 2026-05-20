import { OnsectiveClient } from '../client';

export type WebhookEventKind =
  | 'ORDER_PLACED' | 'ORDER_PAID' | 'ORDER_CANCELLED'
  | 'SHIPMENT_LABEL_CREATED' | 'SHIPMENT_DELIVERED'
  | 'RETURN_REQUESTED' | 'RETURN_APPROVED' | 'RETURN_REFUNDED'
  | 'REVIEW_POSTED' | 'PAYOUT_PAID';

export interface WebhookEndpointRow {
  id: string;
  name: string;
  url: string;
  events: WebhookEventKind[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookEndpointWithSecret extends WebhookEndpointRow {
  secret: string;
}

export interface WebhookDeliveryRow {
  id: string;
  endpointId: string;
  event: WebhookEventKind;
  status: 'PENDING' | 'DELIVERED' | 'RETRYING' | 'DEAD';
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastResponseStatus: number | null;
  lastError: string | null;
  createdAt: string;
}

export class SellerWebhooksApi {
  constructor(private readonly client: OnsectiveClient) {}

  list() {
    return this.client.request<WebhookEndpointRow[]>('/seller/webhooks');
  }
  create(body: { name: string; url: string; events: WebhookEventKind[] }) {
    return this.client.request<WebhookEndpointWithSecret>('/seller/webhooks', { method: 'POST', body });
  }
  update(id: string, body: { name?: string; url?: string; events?: WebhookEventKind[]; active?: boolean }) {
    return this.client.request<WebhookEndpointRow>(`/seller/webhooks/${id}`, { method: 'PATCH', body });
  }
  rotate(id: string) {
    return this.client.request<{ id: string; secret: string }>(`/seller/webhooks/${id}/rotate`, { method: 'POST' });
  }
  remove(id: string) {
    return this.client.request<{ ok: boolean }>(`/seller/webhooks/${id}`, { method: 'DELETE' });
  }
  deliveries(id: string) {
    return this.client.request<WebhookDeliveryRow[]>(`/seller/webhooks/${id}/deliveries`);
  }
}
