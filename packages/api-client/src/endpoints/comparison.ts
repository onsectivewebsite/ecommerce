import { OnsectiveClient } from '../client';

export interface ComparisonProduct {
  productId: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  currency: string;
  priceMinor: number;
  condition: string | null;
  brandName: string | null;
  sellerName: string;
  categoryName: string;
  inStock: boolean;
  ratingAvg: number;
  ratingCount: number;
  attributes: Record<string, unknown>;
  addedAt: string;
}

export class ComparisonApi {
  constructor(private readonly client: OnsectiveClient) {}

  list() {
    return this.client.request<ComparisonProduct[]>('/comparison');
  }
  add(productId: string) {
    return this.client.request<ComparisonProduct[]>(`/comparison/${productId}`, { method: 'POST' });
  }
  remove(productId: string) {
    return this.client.request<ComparisonProduct[]>(`/comparison/${productId}`, { method: 'DELETE' });
  }
  clear() {
    return this.client.request<{ ok: true }>('/comparison', { method: 'DELETE' });
  }
}
