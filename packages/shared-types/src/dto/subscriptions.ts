export type SubscriptionTier = 'BASIC' | 'PRO' | 'ENTERPRISE';
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

export interface TierDefinitionDto {
  tier: SubscriptionTier;
  displayName: string;
  monthlyPriceMinor: number;
  currency: string;
  features: {
    bulkImport: boolean;
    analyticsAdvanced: boolean;
    variantMatrix: boolean;
    listingFeeOverride: boolean;
    maxActiveProducts: number;
  };
  description: string;
}

export interface SellerSubscriptionDto {
  id: string;
  sellerId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelledAt?: string | null;
  definition: TierDefinitionDto;
}

export interface StartSubscriptionRequest {
  tier: SubscriptionTier;
  paymentProvider: 'mock' | 'stripe' | 'razorpay' | 'paypal';
}

export interface StartSubscriptionResponse {
  instant: boolean;
  paymentRef: string | null;
  clientSecret?: string | null;
}
