import type {
  AnalyticsRange,
  AnalyticsSummaryDto,
  BulkImportReportDto,
  CreateProductRequest,
  OrderDto,
  PaginatedProducts,
  ProductDetailDto,
  TopSkuDto,
} from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export interface CreateSellerProfileRequest {
  storeName: string;
  displayName: string;
  payoutCurrency: string;
}

export class SellerApi {
  constructor(private readonly client: OnsectiveClient) {}

  createProfile(body: CreateSellerProfileRequest) {
    return this.client.request<{ id: string; status: string }>('/seller/profile', {
      method: 'POST',
      body,
    });
  }

  myProfile() {
    return this.client.request<{
      id: string;
      storeName: string;
      displayName: string;
      status: string;
      commissionBps: number | null;
    }>('/seller/profile');
  }

  listProducts(page = 1, pageSize = 20) {
    return this.client.request<PaginatedProducts>('/seller/products', {
      query: { page, pageSize },
    });
  }

  createProduct(body: CreateProductRequest) {
    return this.client.request<ProductDetailDto>('/seller/products', { method: 'POST', body });
  }

  listOrders() {
    return this.client.request<OrderDto[]>('/seller/orders');
  }

  // Phase 3 — bulk import
  bulkImport(csv: string, dryRun: boolean) {
    return this.client.request<BulkImportReportDto>('/seller/products/bulk-import', {
      method: 'POST',
      body: { csv },
      headers: dryRun ? { 'x-dry-run': '1' } : {},
    });
  }

  // Phase 3 — analytics
  analyticsSummary(range: AnalyticsRange = '30d') {
    return this.client.request<AnalyticsSummaryDto>('/seller/analytics/summary', { query: { range } });
  }

  analyticsTopSkus(range: AnalyticsRange = '30d', limit = 10) {
    return this.client.request<TopSkuDto[]>('/seller/analytics/top-skus', { query: { range, limit } });
  }
}
