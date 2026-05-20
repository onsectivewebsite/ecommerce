import type {
  AddressDto,
  CheckoutRequest,
  CheckoutResponse,
  CreateAddressRequest,
  OrderDto,
} from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export class OrdersApi {
  constructor(private readonly client: OnsectiveClient) {}

  listMyAddresses() {
    return this.client.request<AddressDto[]>('/users/me/addresses');
  }

  createAddress(body: CreateAddressRequest) {
    return this.client.request<AddressDto>('/users/me/addresses', { method: 'POST', body });
  }

  checkout(body: CheckoutRequest) {
    return this.client.request<CheckoutResponse>('/orders/checkout', { method: 'POST', body });
  }

  list() {
    return this.client.request<OrderDto[]>('/orders');
  }

  get(orderId: string) {
    return this.client.request<OrderDto>(`/orders/${orderId}`);
  }

  mockCapture(orderId: string) {
    return this.client.request<OrderDto>(`/payments/mock/capture/${orderId}`, { method: 'POST' });
  }
}
