import type {
  AgeConsentRequest,
  AgeConsentResultDto,
  CategoryComplianceDto,
  ReviewComplianceDocRequest,
  SellerComplianceDocDto,
  UploadComplianceDocRequest,
  UpsertCategoryComplianceRequest,
} from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export class ComplianceApi {
  constructor(private readonly client: OnsectiveClient) {}

  // ---- Buyer / public ----

  getCategoryRule(slug: string) {
    return this.client.request<CategoryComplianceDto | { categorySlug: string }>(
      `/compliance/rules/${encodeURIComponent(slug)}`,
      { noAuth: true },
    );
  }

  submitAgeConsent(body: AgeConsentRequest) {
    return this.client.request<AgeConsentResultDto>('/compliance/age-consent', {
      method: 'POST',
      body,
    });
  }

  submitAgeConsentGuest(body: AgeConsentRequest) {
    return this.client.request<AgeConsentResultDto>('/compliance/age-consent/guest', {
      method: 'POST',
      body,
      noAuth: true,
    });
  }

  // ---- Seller ----

  sellerRules() {
    return this.client.request<CategoryComplianceDto[]>('/seller/compliance/rules');
  }

  myDocs() {
    return this.client.request<SellerComplianceDocDto[]>('/seller/compliance/docs');
  }

  uploadDoc(body: UploadComplianceDocRequest) {
    return this.client.request<SellerComplianceDocDto>('/seller/compliance/docs', {
      method: 'POST',
      body,
    });
  }

  // ---- Admin ----

  adminListRules() {
    return this.client.request<CategoryComplianceDto[]>('/admin/compliance/rules');
  }

  adminUpsertRule(categoryId: string, body: UpsertCategoryComplianceRequest) {
    return this.client.request<CategoryComplianceDto>(
      `/admin/compliance/rules/${encodeURIComponent(categoryId)}`,
      { method: 'PUT', body },
    );
  }

  adminDeleteRule(categoryId: string) {
    return this.client.request<{ ok: true }>(
      `/admin/compliance/rules/${encodeURIComponent(categoryId)}`,
      { method: 'DELETE' },
    );
  }

  adminListPendingDocs() {
    return this.client.request<SellerComplianceDocDto[]>('/admin/compliance/docs');
  }

  adminViewDocUrl(id: string, ttl = 300) {
    return this.client.request<{ url: string | null }>(
      `/admin/compliance/docs/${encodeURIComponent(id)}/view`,
      { query: { ttl } },
    );
  }

  adminReviewDoc(id: string, body: ReviewComplianceDocRequest) {
    return this.client.request<SellerComplianceDocDto>(
      `/admin/compliance/docs/${encodeURIComponent(id)}/review`,
      { method: 'POST', body },
    );
  }
}
