import type {
  AdBudgetDto,
  AdCampaignDto,
  AdPlacementDto,
  AdPlacementType,
  AddAdPlacementRequest,
  CreateAdCampaignRequest,
  RecordImpressionRequest,
  ResolvedAdDto,
} from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export class AdsApi {
  constructor(private readonly client: OnsectiveClient) {}

  // ---- Buyer ----

  serve(type: AdPlacementType, opts: { q?: string; category?: string; exclude?: string[] } = {}) {
    return this.client.request<ResolvedAdDto | null>(`/ads/serve/${type}`, {
      query: { q: opts.q, category: opts.category, exclude: opts.exclude?.join(',') },
      noAuth: true,
    });
  }

  recordImpression(body: RecordImpressionRequest) {
    return this.client.request<unknown>('/ads/impression', { method: 'POST', body, noAuth: true });
  }

  /**
   * Build a click URL for an `<a href>` — the server 302s to the destination.
   * baseUrl should be the API origin (e.g. http://localhost:4000).
   */
  clickUrl(baseUrl: string, placementId: string, eventKey?: string, buyerSessionId?: string): string {
    const url = new URL(`/ads/click/${encodeURIComponent(placementId)}`, baseUrl);
    if (eventKey) url.searchParams.set('k', eventKey);
    if (buyerSessionId) url.searchParams.set('sid', buyerSessionId);
    return url.toString();
  }

  // ---- Seller ----

  budget() {
    return this.client.request<AdBudgetDto>('/seller/ads/budget');
  }

  topUp(amountMinor: number, paymentProvider: 'mock' | 'stripe' = 'mock') {
    return this.client.request<{ instant: boolean; paymentRef: string | null; clientSecret?: string | null }>(
      '/seller/ads/top-up', { method: 'POST', body: { amountMinor, paymentProvider } },
    );
  }

  listCampaigns() {
    return this.client.request<AdCampaignDto[]>('/seller/ads/campaigns');
  }

  getCampaign(id: string) {
    return this.client.request<AdCampaignDto>(`/seller/ads/campaigns/${id}`);
  }

  createCampaign(body: CreateAdCampaignRequest) {
    return this.client.request<AdCampaignDto>('/seller/ads/campaigns', { method: 'POST', body });
  }

  updateCampaign(id: string, body: Partial<CreateAdCampaignRequest> & { status?: AdCampaignDto['status'] }) {
    return this.client.request<AdCampaignDto>(`/seller/ads/campaigns/${id}`, { method: 'PATCH', body });
  }

  addPlacement(campaignId: string, body: AddAdPlacementRequest) {
    return this.client.request<AdPlacementDto>(`/seller/ads/campaigns/${campaignId}/placements`, {
      method: 'POST', body,
    });
  }

  deletePlacement(id: string) {
    return this.client.request<{ ok: true }>(`/seller/ads/placements/${id}`, { method: 'DELETE' });
  }
}
