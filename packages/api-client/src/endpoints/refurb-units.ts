import { OnsectiveClient } from '../client';

export type RefurbUnitAvailability =
  | 'AVAILABLE'
  | 'RESERVED'
  | 'SOLD'
  | 'WITHDRAWN'
  | 'QUARANTINED';

export type ProductCondition =
  | 'NEW_GENUINE'
  | 'REFURB_GRADE_A'
  | 'REFURB_GRADE_B'
  | 'REFURB_GRADE_C';

export interface RefurbUnitAiSummary {
  suggestion: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';
  confidence: number;
  modelName: string;
  modelVersion: string;
  runId: string | null;
  signals: Array<{ name: string; score: number; severity: 'INFO' | 'WARN' | 'BLOCK'; reason: string }>;
  generatedAt: string;
}

export interface RefurbUnitRow {
  id: string;
  productId: string;
  sellerId: string;
  warehouseId: string | null;
  serialNumber: string;
  imei: string | null;
  priceMinor: number;
  currency: string;
  conditionReport: Record<string, unknown>;
  unitPhotoMediaIds: string[];
  availability: RefurbUnitAvailability;
  warrantyMonths: number;
  variantId: string | null;
  aiSummary: RefurbUnitAiSummary | null;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; slug: string; title: string; condition: ProductCondition };
}

export interface CreateRefurbUnitPayload {
  productId: string;
  serialNumber: string;
  imei?: string;
  priceMinor: number;
  warehouseId?: string;
  conditionReport?: Record<string, unknown>;
  unitPhotoMediaIds?: string[];
}

export interface UpdateRefurbUnitPayload {
  priceMinor?: number;
  conditionReport?: Record<string, unknown>;
  unitPhotoMediaIds?: string[];
  warehouseId?: string;
  withdraw?: boolean;
}

export interface SerialLookupResult {
  serialNumber: string;
  productSlug: string;
  productTitle: string;
  condition: ProductCondition;
  availability: RefurbUnitAvailability;
  checks: Array<{ outcome: string; createdAt: string; reason: string | null }>;
}

export class RefurbUnitsApi {
  constructor(private readonly client: OnsectiveClient) {}

  forProduct(productId: string) {
    return this.client.request<RefurbUnitRow[]>(`/refurb-units/by-product/${productId}`);
  }
  one(id: string) {
    return this.client.request<RefurbUnitRow>(`/refurb-units/${id}`);
  }
  lookupSerial(serial: string) {
    return this.client.request<SerialLookupResult | null>('/refurb-units/lookup', {
      query: { serial },
    });
  }

  mine() {
    return this.client.request<RefurbUnitRow[]>('/seller/refurb-units');
  }
  create(body: CreateRefurbUnitPayload) {
    return this.client.request<RefurbUnitRow>('/seller/refurb-units', { method: 'POST', body });
  }
  update(id: string, body: UpdateRefurbUnitPayload) {
    return this.client.request<RefurbUnitRow>(`/seller/refurb-units/${id}`, {
      method: 'PATCH',
      body,
    });
  }
}
