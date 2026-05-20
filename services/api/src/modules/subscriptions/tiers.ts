import type { SubscriptionTier } from '@prisma/client';

export interface TierDefinition {
  tier: SubscriptionTier;
  displayName: string;
  monthlyPriceMinor: number;
  currency: string;
  features: {
    bulkImport: boolean;
    analyticsAdvanced: boolean;
    variantMatrix: boolean;
    listingFeeOverride: boolean;
    maxActiveProducts: number; // -1 = unlimited
  };
  description: string;
}

export const TIERS: Record<SubscriptionTier, TierDefinition> = {
  BASIC: {
    tier: 'BASIC',
    displayName: 'Basic',
    monthlyPriceMinor: 0,
    currency: 'USD',
    features: {
      bulkImport: false,
      analyticsAdvanced: false,
      variantMatrix: false,
      listingFeeOverride: false,
      maxActiveProducts: 100,
    },
    description: 'Get started for free. Sell up to 100 active products.',
  },
  PRO: {
    tier: 'PRO',
    displayName: 'Pro',
    monthlyPriceMinor: 2900,
    currency: 'USD',
    features: {
      bulkImport: true,
      analyticsAdvanced: true,
      variantMatrix: true,
      listingFeeOverride: false,
      maxActiveProducts: 5000,
    },
    description: 'For growing brands. Bulk import, full analytics, variant matrix.',
  },
  ENTERPRISE: {
    tier: 'ENTERPRISE',
    displayName: 'Enterprise',
    monthlyPriceMinor: 19900,
    currency: 'USD',
    features: {
      bulkImport: true,
      analyticsAdvanced: true,
      variantMatrix: true,
      listingFeeOverride: true,
      maxActiveProducts: -1,
    },
    description: 'For scaled merchants. Unlimited products plus listing-fee negotiation.',
  },
};

export type TierFeature = keyof TierDefinition['features'];

export function tierHas(tier: SubscriptionTier, feature: Exclude<TierFeature, 'maxActiveProducts'>): boolean {
  return Boolean(TIERS[tier].features[feature]);
}

export function tierAllowsProductCount(tier: SubscriptionTier, count: number): boolean {
  const max = TIERS[tier].features.maxActiveProducts;
  return max === -1 || count <= max;
}
