import { OnsectiveClient } from '../client';

export type CollectionStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface CollectionSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  heroImageUrl: string | null;
  position: number;
  itemCount: number;
  createdAt: string;
}

export interface CollectionProduct {
  id: string;
  slug: string;
  title: string;
  currency: string;
  basePriceMinor: number;
  condition: string | null;
  sellerName: string;
  brand: { name: string; slug: string; logoUrl: string | null } | null;
  media: Array<{ id: string; url: string; alt: string | null; position: number }>;
  position: number;
}

export interface PublicCollection extends CollectionSummary {
  products: CollectionProduct[];
}

export interface AdminCollection extends CollectionSummary {
  status: CollectionStatus;
  updatedAt: string;
}

export interface AdminCollectionDetail extends AdminCollection {
  items: Array<{
    productId: string;
    position: number;
    slug: string;
    title: string;
    status: string;
  }>;
}

export interface CreateCollectionBody {
  slug: string;
  title: string;
  description?: string;
  heroImageUrl?: string;
  status?: CollectionStatus;
  position?: number;
}

export type UpdateCollectionBody = Partial<CreateCollectionBody>;

export class CollectionsApi {
  constructor(private readonly client: OnsectiveClient) {}

  publicList() {
    return this.client.request<CollectionSummary[]>('/collections');
  }
  publicGetBySlug(slug: string) {
    return this.client.request<PublicCollection>(`/collections/${slug}`);
  }

  adminList() {
    return this.client.request<AdminCollection[]>('/admin/collections');
  }
  adminGet(id: string) {
    return this.client.request<AdminCollectionDetail>(`/admin/collections/${id}`);
  }
  adminCreate(body: CreateCollectionBody) {
    return this.client.request<AdminCollectionDetail>('/admin/collections', { method: 'POST', body });
  }
  adminUpdate(id: string, body: UpdateCollectionBody) {
    return this.client.request<AdminCollectionDetail>(`/admin/collections/${id}`, { method: 'PATCH', body });
  }
  adminRemove(id: string) {
    return this.client.request<{ ok: true }>(`/admin/collections/${id}`, { method: 'DELETE' });
  }
  adminAddItem(id: string, body: { productId: string; position?: number }) {
    return this.client.request<AdminCollectionDetail>(`/admin/collections/${id}/items`, { method: 'POST', body });
  }
  adminRemoveItem(id: string, productId: string) {
    return this.client.request<AdminCollectionDetail>(`/admin/collections/${id}/items/${productId}`, { method: 'DELETE' });
  }
  adminReorderItem(id: string, productId: string, body: { position: number }) {
    return this.client.request<AdminCollectionDetail>(`/admin/collections/${id}/items/${productId}`, { method: 'PATCH', body });
  }
}
