export const SUPPORTED_LOCALES = ['en', 'hi', 'fr', 'ja', 'zh', 'ur', 'bn', 'vi', 'ru'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const SUPPORTED_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY', 'CNY', 'RUB', 'PKR', 'BDT', 'VND',
] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedLocale(v: string): v is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

export function isSupportedCurrency(v: string): v is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(v.toUpperCase());
}
