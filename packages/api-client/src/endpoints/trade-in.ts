import { OnsectiveClient } from '../client';

export type TradeInGrade = 'GRADE_A' | 'GRADE_B' | 'GRADE_C' | 'REJECT';
export type TradeInOrderStatus =
  | 'CREATED' | 'KIT_SHIPPED' | 'IN_TRANSIT' | 'RECEIVED'
  | 'GRADED' | 'PAID' | 'REJECTED' | 'CANCELLED';
export type TradeInPayoutMethod = 'WALLET' | 'STRIPE';

export interface TradeInModelRow {
  id: string;
  sourceProductId: string;
  destinationProductId: string;
  baseOfferMinor: number;
  currency: string;
  gradeMultipliers: Record<TradeInGrade, number>;
  accessoryAdjustments: Array<{ key: string; amountMinor: number; label?: string }>;
  assignedRefurbiserId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  sourceProduct?: { id: string; slug: string; title: string };
  destinationProduct?: { id: string; slug: string; title: string; condition: string };
  assignedRefurbiser?: { id: string; displayName: string } | null;
}

export interface TradeInOrderRow {
  id: string;
  buyerUserId: string;
  modelId: string;
  warehouseId: string;
  status: TradeInOrderStatus;
  declaredGrade: TradeInGrade;
  actualGrade: TradeInGrade | null;
  accessories: string[];
  offerMinor: number;
  finalPayoutMinor: number | null;
  currency: string;
  payoutMethod: TradeInPayoutMethod;
  shipBackTracking: string | null;
  shipBackLabelUrl: string | null;
  shipBackCarrier: string | null;
  rejectionReason: string | null;
  refurbUnitId: string | null;
  receivedAt: string | null;
  gradedAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  model?: { sourceProduct?: { slug: string; title: string } };
}

export interface QuoteResponse {
  quoteId: string;
  offerMinor: number;
  currency: string;
  expiresAt: string;
  signature: string;
  modelId: string;
  requiresPhotos: boolean;
}

export interface QuoteRequestPayload {
  productSlug: string;
  declaredGrade: TradeInGrade;
  accessories: string[];
}

export interface AcceptQuotePayload extends QuoteResponse {
  declaredGrade: TradeInGrade;
  accessories: string[];
  payoutMethod?: TradeInPayoutMethod;
}

export interface IntakePayload {
  orderId: string;
  photoUrls: string[];
  conditionNotes?: string;
}

export interface GradingPayload {
  orderId: string;
  actualGrade: TradeInGrade;
  notes?: string;
  evidenceUrls?: string[];
}

export interface CreateTradeInModelPayload {
  sourceProductId: string;
  destinationProductId: string;
  baseOfferMinor: number;
  currency: string;
  gradeMultipliers: Record<TradeInGrade, number>;
  accessoryAdjustments: Array<{ key: string; amountMinor: number; label?: string }>;
  assignedRefurbiserId?: string;
}

export class TradeInApi {
  constructor(private readonly client: OnsectiveClient) {}

  // public
  quote(body: QuoteRequestPayload) {
    return this.client.request<QuoteResponse>('/trade-in/quotes', { method: 'POST', body });
  }

  // buyer
  mine() {
    return this.client.request<TradeInOrderRow[]>('/trade-in/orders');
  }
  accept(body: AcceptQuotePayload) {
    return this.client.request<TradeInOrderRow>('/trade-in/orders', { method: 'POST', body });
  }
  cancel(id: string) {
    return this.client.request<TradeInOrderRow>(`/trade-in/orders/${id}/cancel`, { method: 'POST' });
  }

  // warehouse
  warehouseQueue(warehouseId?: string) {
    return this.client.request<TradeInOrderRow[]>('/warehouse/trade-in/queue', {
      query: { warehouseId },
    });
  }
  intake(body: IntakePayload) {
    return this.client.request<{ id: string }>('/warehouse/trade-in/intake', { method: 'POST', body });
  }
  grade(body: GradingPayload) {
    return this.client.request<TradeInOrderRow>('/warehouse/trade-in/grade', { method: 'POST', body });
  }

  // admin
  adminModels() {
    return this.client.request<TradeInModelRow[]>('/admin/trade-in/models');
  }
  adminCreateModel(body: CreateTradeInModelPayload) {
    return this.client.request<TradeInModelRow>('/admin/trade-in/models', { method: 'POST', body });
  }
}
