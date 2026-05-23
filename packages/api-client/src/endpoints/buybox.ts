import { OnsectiveClient } from '../client';

export interface BuyBoxWinner {
  listingId: string;
  sellerId: string;
  sellerName: string;
  sellerStoreSlug: string;
  priceMinor: number;
  currency: string;
  condition: string;
  fulfillmentMode: 'SELLER' | 'PLATFORM';
  isOnsectiveFulfilled: boolean;
}

export interface BuyBoxResponse {
  productId: string;
  winner: BuyBoxWinner | null;
}

export class BuyBoxApi {
  constructor(private readonly client: OnsectiveClient) {}

  /** Public — PDP fetches this for the price + "Sold by" + CTA target. */
  winnerFor(productId: string) {
    return this.client.request<BuyBoxResponse>(`/buybox/${productId}`);
  }
}
