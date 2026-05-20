export type AdPlacementType = 'SPONSORED_PRODUCT' | 'SEARCH_SPONSOR' | 'BANNER_SLOT';
export type AdPricingModel = 'CPC' | 'CPM';
export type AdCampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'EXHAUSTED';

export interface AdCampaignDto {
  id: string;
  sellerId: string;
  name: string;
  status: AdCampaignStatus;
  pricingModel: AdPricingModel;
  bidMinor: number;
  currency: string;
  dailyBudgetMinor: number;
  totalBudgetMinor: number;
  spentMinor: number;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  placements?: AdPlacementDto[];
}

export interface AdPlacementDto {
  id: string;
  campaignId: string;
  type: AdPlacementType;
  productId: string | null;
  searchKeyword: string | null;
  categorySlug: string | null;
  weight: number;
  destinationUrl: string | null;
  product?: { id: string; slug: string; title: string } | null;
}

export interface ResolvedAdDto {
  campaignId: string;
  placementId: string;
  type: AdPlacementType;
  productId: string | null;
  destinationUrl: string | null;
  sellerId: string;
  sellerName?: string;
  product?: {
    id: string;
    slug: string;
    title: string;
    basePriceMinor: number;
    currency: string;
    imageUrl: string | null;
  } | null;
}

export interface AdBudgetDto {
  availableMinor: number;
  currency: string;
}

export interface CreateAdCampaignRequest {
  name: string;
  pricingModel: AdPricingModel;
  bidMinor: number;
  currency?: string;
  dailyBudgetMinor?: number;
  totalBudgetMinor?: number;
  priority?: number;
}

export interface AddAdPlacementRequest {
  type: AdPlacementType;
  productId?: string;
  searchKeyword?: string;
  categorySlug?: string;
  weight?: number;
  destinationUrl?: string;
}

export interface RecordImpressionRequest {
  campaignId: string;
  placementId: string;
  eventKey?: string;
  buyerSessionId?: string;
}
