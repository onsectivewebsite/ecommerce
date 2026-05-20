export type CarrierCode = 'mock' | 'fedex' | 'ups' | 'dhl' | 'canadapost';

export type ShipmentStatus =
  | 'PENDING'
  | 'LABEL_PURCHASED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'EXCEPTION'
  | 'CANCELLED';

export type ShipmentEventCode =
  | 'label_created'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'cancelled';

export type ShipmentEventSource = 'CARRIER' | 'PARTNER' | 'ADMIN' | 'SYSTEM';

export interface ShipmentEventDto {
  id?: string;
  code: ShipmentEventCode | string;
  label: string;
  description?: string | null;
  locationCity?: string | null;
  locationCountry?: string | null;
  occurredAt: string;
  source?: ShipmentEventSource;
}

export interface ShipmentPublicDto {
  id: string;
  orderId: string;
  carrierCode: CarrierCode;
  serviceLevel: string;
  status: ShipmentStatus;
  trackingNumber: string | null;
  deliveredAt: string | null;
  destinationCity: string;
  destinationCountry: string;
  sellerName: string;
  events: ShipmentEventDto[];
}

export interface ShippingQuoteOption {
  carrier: CarrierCode;
  serviceLevel: string;
  serviceDisplayName: string;
  amountMinor: number;
  currency: string;
  estimatedDeliveryDays: number;
  degraded?: boolean;
}

export interface ShippingQuoteResponse {
  options: ShippingQuoteOption[];
  flat: { amountMinor: number; currency: string };
}

export interface CarrierListItem {
  code: CarrierCode;
  displayName: string;
  live: boolean;
}

export interface ShippingMilestoneRequest {
  code: 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception';
  label: string;
  description?: string;
  locationCity?: string;
  locationCountry?: string;
}
