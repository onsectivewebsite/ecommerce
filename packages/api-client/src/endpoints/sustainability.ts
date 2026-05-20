import { OnsectiveClient } from '../client';

export type SustainabilitySubjectKind =
  | 'REFURB_PURCHASE'
  | 'OPENBOX_PURCHASE'
  | 'TRADEIN_PAYOUT'
  | 'REPAIR_COMPLETED';

export interface SustainabilityTotals {
  kgCo2Saved: number;
  kgMaterialDiverted: number;
  lifeExtensionYears: number;
  events: number;
}

export interface SustainabilityImpactRow {
  id: string;
  subjectKind: SustainabilitySubjectKind;
  subjectId: string;
  buyerUserId: string | null;
  sellerId: string | null;
  brandId: string | null;
  categorySlug: string;
  kgCo2Saved: number;
  kgMaterialDiverted: number;
  lifeExtensionYears: number;
  reason: string | null;
  createdAt: string;
}

export interface BuyerLifetimeResult {
  totals: SustainabilityTotals;
  recent: SustainabilityImpactRow[];
}

export interface BySubjectBreakdown {
  subjectKind: SustainabilitySubjectKind;
  kgCo2Saved: number;
  kgMaterialDiverted: number;
  events: number;
}

export interface BrandTotalsResult {
  totals: SustainabilityTotals;
  bySubject: BySubjectBreakdown[];
}

export interface TopBrandImpact {
  brandId: string;
  kgCo2Saved: number;
  brand: { id: string; slug: string; name: string; logoUrl: string | null } | null;
}

export interface PlatformTotalsResult {
  totals: SustainabilityTotals;
  bySubject: BySubjectBreakdown[];
  topBrands90d: TopBrandImpact[];
}

export interface SustainabilityFactorRow {
  id: string;
  categorySlug: string;
  brandId: string | null;
  kgCo2PerRefurb: number;
  kgMaterialPerRefurb: number;
  lifeExtensionYears: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertFactorPayload {
  categorySlug: string;
  brandId?: string;
  kgCo2PerRefurb: number;
  kgMaterialPerRefurb: number;
  lifeExtensionYears: number;
  notes?: string;
}

export class SustainabilityApi {
  constructor(private readonly client: OnsectiveClient) {}

  platform() {
    return this.client.request<PlatformTotalsResult>('/sustainability/platform');
  }
  brand(brandId: string) {
    return this.client.request<BrandTotalsResult>(`/sustainability/brands/${brandId}`);
  }
  mine() {
    return this.client.request<BuyerLifetimeResult>('/account/sustainability');
  }
  adminListFactors() {
    return this.client.request<SustainabilityFactorRow[]>('/admin/sustainability/factors');
  }
  adminUpsertFactor(body: UpsertFactorPayload) {
    return this.client.request<SustainabilityFactorRow>('/admin/sustainability/factors', {
      method: 'POST',
      body,
    });
  }
}
