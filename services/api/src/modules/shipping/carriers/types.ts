export type CarrierCode = 'mock' | 'fedex' | 'ups' | 'dhl' | 'canadapost';

export interface ShipAddress {
  fullName: string;
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string; // ISO-2
  phone?: string | null;
  email?: string | null;
}

export interface ParcelDimensions {
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

export interface QuoteInput {
  origin: ShipAddress;
  destination: ShipAddress;
  weightGrams: number;
  dimensions?: ParcelDimensions;
  currency: string;
  declaredValueMinor?: number;
  serviceLevel?: string; // restrict quote to a single service
}

export interface QuoteResult {
  carrier: CarrierCode;
  serviceLevel: string;
  serviceDisplayName: string;
  amountMinor: number;
  currency: string;
  estimatedDeliveryDays: number;
  degraded?: boolean; // true when we fell back to mock pricing
  raw?: Record<string, unknown>;
}

export interface CustomsLineItem {
  description: string;
  hsnCode?: string | null;
  tariffCountry?: string | null; // ISO-2
  qty: number;
  unitValueMinor: number;
  currency: string;
}

export interface PurchaseInput extends QuoteInput {
  orderId: string;
  shipmentId: string;
  serviceLevel: string;
  rateProviderRef?: string;
  reference?: string;
  customs?: CustomsLineItem[]; // Phase 5: populated when shipping cross-border
}

export interface LabelResult {
  trackingNumber: string;
  serviceLevel: string;
  labelPdf: Buffer;        // raw PDF bytes
  labelMime: 'application/pdf';
  amountMinor: number;
  currency: string;
  raw?: Record<string, unknown>;
}

export type NormalizedEventCode =
  | 'label_created'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'cancelled';

export interface NormalizedEvent {
  trackingNumber: string;
  code: NormalizedEventCode;
  label: string;
  description?: string;
  locationCity?: string;
  locationCountry?: string;
  occurredAt: Date;
  raw: unknown;
}

export interface CarrierAdapter {
  readonly code: CarrierCode;
  readonly displayName: string;
  /** True when configured for live API calls; false when running mock-fallback. */
  isLive(): boolean;
  quote(input: QuoteInput): Promise<QuoteResult[]>;
  purchaseLabel(input: PurchaseInput): Promise<LabelResult>;
  track(trackingNumber: string): Promise<NormalizedEvent[]>;
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent[];
  cancel?(trackingNumber: string): Promise<void>;
}

export const CARRIER_ADAPTERS = Symbol('CARRIER_ADAPTERS');
