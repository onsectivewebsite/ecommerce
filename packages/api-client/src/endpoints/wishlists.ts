import { OnsectiveClient } from '../client';

export interface WishlistView {
  id: string;
  name: string;
  shareToken: string | null;
  items: Array<{
    id: string;
    productId: string;
    slug: string;
    title: string;
    currency: string;
    currentPriceMinor: number;
    snapshotPriceMinor: number;
    snapshotInStock: boolean;
    imageUrl: string | null;
    addedAt: string;
  }>;
}

export class WishlistsApi {
  constructor(private readonly client: OnsectiveClient) {}

  mine() {
    return this.client.request<WishlistView>('/wishlists');
  }
  add(productId: string) {
    return this.client.request<WishlistView>('/wishlists/items', { method: 'POST', body: { productId } });
  }
  remove(productId: string) {
    return this.client.request<WishlistView>(`/wishlists/items/${productId}`, { method: 'DELETE' });
  }
  share() {
    return this.client.request<{ shareToken: string }>('/wishlists/share', { method: 'POST' });
  }
  unshare() {
    return this.client.request<{ ok: boolean }>('/wishlists/share', { method: 'DELETE' });
  }
  publicByToken(token: string) {
    return this.client.request<{ items: WishlistView['items']; sharedAt: string }>(`/wishlists/shared/${token}`);
  }
}
