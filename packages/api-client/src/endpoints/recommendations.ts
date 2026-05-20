import type { ProductSummaryDto } from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export class RecommendationsApi {
  constructor(private readonly client: OnsectiveClient) {}

  fbt(productId: string) {
    return this.client.request<ProductSummaryDto[]>('/recommendations/fbt', {
      query: { productId },
      noAuth: true,
    });
  }

  similar(productId: string) {
    return this.client.request<ProductSummaryDto[]>('/recommendations/similar', {
      query: { productId },
      noAuth: true,
    });
  }

  forYou() {
    return this.client.request<ProductSummaryDto[]>('/recommendations/for-you', { noAuth: true });
  }

  mine() {
    return this.client.request<ProductSummaryDto[]>('/recommendations/mine');
  }
}
