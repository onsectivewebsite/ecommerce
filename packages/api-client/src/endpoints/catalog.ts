import type {
  CategoryDto,
  PaginatedProducts,
  ProductDetailDto,
} from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export interface ListProductsParams {
  query?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  sellerId?: string;
}

export class CatalogApi {
  constructor(private readonly client: OnsectiveClient) {}

  listCategories() {
    return this.client.request<CategoryDto[]>('/catalog/categories', { noAuth: true });
  }

  listProducts(params: ListProductsParams = {}) {
    return this.client.request<PaginatedProducts>('/catalog/products', {
      query: { ...params },
      noAuth: true,
    });
  }

  getProduct(slug: string) {
    return this.client.request<ProductDetailDto>(`/catalog/products/${encodeURIComponent(slug)}`, {
      noAuth: true,
    });
  }
}
