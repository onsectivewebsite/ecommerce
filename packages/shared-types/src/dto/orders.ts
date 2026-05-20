import type { CurrencyCode } from '../money';
import type { OrderStatus, PaymentProvider, PaymentStatus } from '../enums';

export interface AddressDto {
  id: string;
  fullName: string;
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone?: string | null;
  isDefault: boolean;
}

export interface CreateAddressRequest {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone?: string;
  isDefault?: boolean;
}

export interface CheckoutRequest {
  shippingAddressId: string;
  billingAddressId?: string;
  paymentProvider: PaymentProvider;
  // Phase 2 — chosen carrier quote snapshot
  shippingCarrier?: string;
  shippingService?: string;
  shippingAmountMinor?: number;
  // Phase 10 — promo + wallet at checkout
  promotionCodes?: string[];
  walletAmountMinor?: number;
  // Phase 24 — saved-card off-session checkout
  savedPaymentMethodId?: string;
}

export interface OrderItemDto {
  id: string;
  variantId: string;
  productTitleSnapshot: string;
  variantNameSnapshot: string;
  unitPriceMinor: number;
  qty: number;
  lineSubtotalMinor: number;
}

export interface OrderDto {
  id: string;
  status: OrderStatus;
  currency: CurrencyCode;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  commissionMinor: number;
  // Phase 10 — optional so older payload-shapes still type-check.
  walletAppliedMinor?: number;
  promotionLines?: Array<{ code: string; kind: string; scope: 'SELLER' | 'PLATFORM'; amountMinor: number }>;
  shippingAddress: AddressDto;
  billingAddress: AddressDto;
  items: OrderItemDto[];
  sellerId: string;
  sellerName: string;
  createdAt: string;
  payment: {
    provider: PaymentProvider;
    status: PaymentStatus;
    clientSecret?: string | null;
    providerRef?: string | null;
  };
}

export interface CheckoutResponse {
  order: OrderDto;
}
