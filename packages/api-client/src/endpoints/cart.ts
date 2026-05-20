import type {
  AddCartItemRequest,
  CartDto,
  UpdateCartItemRequest,
} from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export class CartApi {
  constructor(private readonly client: OnsectiveClient) {}

  get() {
    return this.client.request<CartDto>('/cart');
  }

  addItem(body: AddCartItemRequest) {
    return this.client.request<CartDto>('/cart/items', { method: 'POST', body });
  }

  updateItem(itemId: string, body: UpdateCartItemRequest) {
    return this.client.request<CartDto>(`/cart/items/${itemId}`, { method: 'PATCH', body });
  }

  removeItem(itemId: string) {
    return this.client.request<CartDto>(`/cart/items/${itemId}`, { method: 'DELETE' });
  }
}
