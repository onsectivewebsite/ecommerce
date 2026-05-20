import type { QuoteInput, QuoteResult, CarrierCode } from './types';

/**
 * Deterministic mock pricing used by every adapter when live credentials are absent.
 * Pricing varies by weight, distance hint (cross-country = different ISO), and service level.
 * Returned amounts are integer minor units in the input currency.
 */
export function mockQuote(
  carrier: CarrierCode,
  displayPrefix: string,
  service: string,
  input: QuoteInput,
  opts: { baseMinor: number; perKgMinor: number; days: number; serviceDisplay: string },
): QuoteResult {
  const kg = Math.max(0.1, input.weightGrams / 1000);
  const crossBorder = input.origin.country !== input.destination.country;
  const crossBorderMinor = crossBorder ? Math.round(opts.baseMinor * 2.5) : 0;
  const amountMinor = Math.round(opts.baseMinor + opts.perKgMinor * kg + crossBorderMinor);
  return {
    carrier,
    serviceLevel: service,
    serviceDisplayName: `${displayPrefix} ${opts.serviceDisplay}`,
    amountMinor,
    currency: input.currency,
    estimatedDeliveryDays: crossBorder ? opts.days + 3 : opts.days,
    degraded: true,
    raw: { mockPricing: true, kg, crossBorder },
  };
}
