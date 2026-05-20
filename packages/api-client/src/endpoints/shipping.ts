import type {
  CarrierListItem,
  ShipmentPublicDto,
  ShippingMilestoneRequest,
  ShippingQuoteResponse,
} from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export class ShippingApi {
  constructor(private readonly client: OnsectiveClient) {}

  carriers() {
    return this.client.request<CarrierListItem[]>('/shipping/carriers', { noAuth: true });
  }

  quote(shippingAddressId: string) {
    return this.client.request<ShippingQuoteResponse>('/shipping/quote', {
      method: 'POST',
      body: { shippingAddressId },
    });
  }

  publicTrack(token: string) {
    return this.client.request<ShipmentPublicDto>(`/shipping/public/${encodeURIComponent(token)}`, {
      noAuth: true,
    });
  }

  get(id: string) {
    return this.client.request<unknown>(`/shipping/${id}`);
  }

  labelUrl(id: string) {
    return this.client.request<{ url: string }>(`/shipping/${id}/label-url`);
  }

  pending() {
    return this.client.request<any[]>('/shipping/partner/pending');
  }

  milestone(id: string, body: ShippingMilestoneRequest) {
    return this.client.request<unknown>(`/shipping/${id}/milestone`, {
      method: 'PATCH',
      body,
    });
  }

  sellerCarriers() {
    return this.client.request<any[]>('/shipping/seller/carriers');
  }

  adminRules(sellerId?: string) {
    return this.client.request<any[]>('/shipping/admin/rules', { query: { sellerId } });
  }
}
