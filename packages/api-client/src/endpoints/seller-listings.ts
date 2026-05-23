import { OnsectiveClient } from '../client';

export type ListingCondition =
  | 'NEW_GENUINE'
  | 'REFURB_GRADE_A'
  | 'REFURB_GRADE_B'
  | 'REFURB_GRADE_C'
  | 'OPEN_BOX';

export type ListingFulfillmentMode = 'SELLER' | 'PLATFORM';

export interface SellerListingRow {
  id: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  productImageUrl: string | null;
  sku: string;
  condition: ListingCondition;
  priceMinor: number;
  currency: string;
  status: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK';
  fulfillmentMode: ListingFulfillmentMode;
  isBuyBoxWinner: boolean;
  createdAt: string;
}

export interface CreateListingBody {
  productId: string;
  sku: string;
  condition: ListingCondition;
  priceMinor: number;
  currency: string;
  fulfillmentMode?: ListingFulfillmentMode;
}

export interface UpdateListingBody {
  sku?: string;
  priceMinor?: number;
  fulfillmentMode?: ListingFulfillmentMode;
}

export class SellerListingsApi {
  constructor(private readonly client: OnsectiveClient) {}

  list() {
    return this.client.request<SellerListingRow[]>('/seller/listings');
  }
  create(body: CreateListingBody) {
    return this.client.request<SellerListingRow>('/seller/listings', { method: 'POST', body });
  }
  update(id: string, body: UpdateListingBody) {
    return this.client.request<SellerListingRow>(`/seller/listings/${id}`, { method: 'PATCH', body });
  }
  deactivate(id: string) {
    return this.client.request<SellerListingRow>(`/seller/listings/${id}/deactivate`, { method: 'POST' });
  }
  reactivate(id: string) {
    return this.client.request<SellerListingRow>(`/seller/listings/${id}/reactivate`, { method: 'POST' });
  }
}
