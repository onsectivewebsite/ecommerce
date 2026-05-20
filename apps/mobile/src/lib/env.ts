import Constants from 'expo-constants';

interface ExtraConfig {
  apiUrl?: string;
  stripePublishableKey?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

export const API_URL = extra.apiUrl ?? 'http://localhost:4000';
export const STRIPE_PUBLISHABLE_KEY = extra.stripePublishableKey ?? '';
export const APPLE_MERCHANT_ID = 'merchant.com.onsective.app';
