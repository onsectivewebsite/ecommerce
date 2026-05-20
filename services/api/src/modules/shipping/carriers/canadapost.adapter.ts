import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import type { CarrierAdapter, CarrierCode, LabelResult, NormalizedEvent, PurchaseInput, QuoteInput, QuoteResult } from './types';
import { mockQuote } from './pricing';
import { renderLabelPdf } from './label-pdf';

/**
 * Canada Post adapter — REST endpoints under /rs/ship/price etc.
 * Live mode requires: CANADAPOST_USERNAME, CANADAPOST_PASSWORD, CANADAPOST_CUSTOMER_NUMBER
 *
 * Canada Post returns XML. We accept JSON-or-XML; this adapter requests JSON via
 * the Accept header introduced in 2023+ for /rs/ratings and /rs/shipments.
 */
@Injectable()
export class CanadaPostAdapter implements CarrierAdapter {
  readonly code: CarrierCode = 'canadapost';
  readonly displayName = 'Canada Post';
  private readonly logger = new Logger(CanadaPostAdapter.name);
  private readonly user?: string;
  private readonly pass?: string;
  private readonly customer?: string;
  private readonly baseUrl: string;

  constructor(cfg: ConfigService) {
    this.user = cfg.get<string>('CANADAPOST_USERNAME') || undefined;
    this.pass = cfg.get<string>('CANADAPOST_PASSWORD') || undefined;
    this.customer = cfg.get<string>('CANADAPOST_CUSTOMER_NUMBER') || undefined;
    this.baseUrl = cfg.get<string>('CANADAPOST_BASE_URL') ?? 'https://ct.soa-gw.canadapost.ca';
  }

  isLive(): boolean { return Boolean(this.user && this.pass && this.customer); }

  private auth(): string {
    return 'Basic ' + Buffer.from(`${this.user}:${this.pass}`).toString('base64');
  }

  async quote(input: QuoteInput): Promise<QuoteResult[]> {
    if (!this.isLive()) return this.mockOptions(input);
    try {
      const res = await fetch(`${this.baseUrl}/rs/ship/price`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.cpc.ship.rate-v4+json',
          Accept: 'application/vnd.cpc.ship.rate-v4+json',
          Authorization: this.auth(),
        },
        body: JSON.stringify({
          'mailing-scenario': {
            'customer-number': this.customer,
            'parcel-characteristics': { weight: Math.max(0.1, input.weightGrams / 1000) },
            'origin-postal-code': input.origin.postalCode.replace(/\s+/g, ''),
            destination: {
              [input.destination.country.toLowerCase() === 'ca' ? 'domestic' : input.destination.country.toLowerCase() === 'us' ? 'united-states' : 'international']: {
                'postal-code': input.destination.postalCode.replace(/\s+/g, ''),
                'country-code': input.destination.country.toUpperCase(),
              },
            },
          },
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Canada Post quote failed (${res.status}); mock fallback`);
        return this.mockOptions(input, true);
      }
      const body = (await res.json()) as any;
      const services = body['price-quotes']?.['price-quote'] ?? [];
      const arr = Array.isArray(services) ? services : [services];
      return arr.map((s) => ({
        carrier: 'canadapost' as const,
        serviceLevel: `canadapost_${String(s['service-code'] ?? 'reg').toLowerCase().replace(/\./g, '_')}`,
        serviceDisplayName: s['service-name'] ?? 'Canada Post',
        amountMinor: Math.round(Number(s['price-details']?.['due'] ?? 0) * 100),
        currency: 'CAD',
        estimatedDeliveryDays: Number(s['service-standard']?.['expected-transit-time'] ?? 5),
        raw: s,
      }));
    } catch (e) {
      this.logger.warn(`Canada Post quote threw ${(e as Error).message}; mock fallback`);
      return this.mockOptions(input, true);
    }
  }

  async purchaseLabel(input: PurchaseInput): Promise<LabelResult> {
    // Canada Post shipment creation is a multi-step flow (create shipment → get artifact).
    // For correctness in dev we render the in-house label PDF and return a mock tracking #;
    // production deploys can drop a fuller implementation behind this same method.
    return this.mockLabel(input);
  }

  async track(_trackingNumber: string): Promise<NormalizedEvent[]> {
    return [];
  }

  parseWebhook(_raw: Buffer): NormalizedEvent[] { return []; }

  private mockOptions(input: QuoteInput, degraded = false): QuoteResult[] {
    return [
      mockQuote('canadapost', 'Canada Post', 'canadapost_regular',    input, { baseMinor: 499,  perKgMinor: 220, days: 5, serviceDisplay: 'Regular Parcel' }),
      mockQuote('canadapost', 'Canada Post', 'canadapost_expedited',  input, { baseMinor: 999,  perKgMinor: 400, days: 3, serviceDisplay: 'Expedited Parcel' }),
    ].map((q) => ({ ...q, degraded: degraded || q.degraded }));
  }

  private async mockLabel(input: PurchaseInput): Promise<LabelResult> {
    const opt = (await this.mockOptions(input)).find((o) => o.serviceLevel === input.serviceLevel)
             ?? (await this.mockOptions(input))[0]!;
    const trackingNumber = `CP-${ulid()}`;
    return {
      trackingNumber,
      serviceLevel: opt.serviceLevel,
      labelMime: 'application/pdf',
      labelPdf: await renderLabelPdf({
        carrierDisplayName: this.displayName,
        serviceDisplayName: opt.serviceDisplayName,
        trackingNumber,
        input,
      }),
      amountMinor: opt.amountMinor,
      currency: opt.currency,
      raw: { mock: true },
    };
  }
}
