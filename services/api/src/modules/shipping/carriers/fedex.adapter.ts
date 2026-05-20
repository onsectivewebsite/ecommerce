import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import type { CarrierAdapter, CarrierCode, LabelResult, NormalizedEvent, PurchaseInput, QuoteInput, QuoteResult } from './types';
import { mockQuote } from './pricing';
import { renderLabelPdf } from './label-pdf';

/**
 * FedEx adapter — wraps the FedEx REST APIs (oAuth, Rates v1, Ship v1, Track v1).
 *
 * Live mode requires:
 *   FEDEX_API_KEY, FEDEX_API_SECRET, FEDEX_ACCOUNT_NUMBER
 *
 * In dev (no creds), every method falls back to deterministic mock pricing while
 * still rendering a real PDF label so the end-to-end flow is exercisable.
 */
@Injectable()
export class FedExAdapter implements CarrierAdapter {
  readonly code: CarrierCode = 'fedex';
  readonly displayName = 'FedEx';
  private readonly logger = new Logger(FedExAdapter.name);

  private readonly key?: string;
  private readonly secret?: string;
  private readonly accountNumber?: string;
  private readonly baseUrl: string;

  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(cfg: ConfigService) {
    this.key = cfg.get<string>('FEDEX_API_KEY') || undefined;
    this.secret = cfg.get<string>('FEDEX_API_SECRET') || undefined;
    this.accountNumber = cfg.get<string>('FEDEX_ACCOUNT_NUMBER') || undefined;
    this.baseUrl = cfg.get<string>('FEDEX_BASE_URL') ?? 'https://apis-sandbox.fedex.com';
  }

  isLive(): boolean {
    return Boolean(this.key && this.secret && this.accountNumber);
  }

  async quote(input: QuoteInput): Promise<QuoteResult[]> {
    if (!this.isLive()) return this.mockOptions(input);
    try {
      const token = await this.token();
      const res = await fetch(`${this.baseUrl}/rate/v1/rates/quotes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-locale': 'en_US',
        },
        body: JSON.stringify({
          accountNumber: { value: this.accountNumber },
          requestedShipment: this.toFedExShipment(input),
        }),
      });
      if (!res.ok) {
        this.logger.warn(`FedEx quote failed (${res.status}); falling back to mock pricing`);
        return this.mockOptions(input, true);
      }
      const body = (await res.json()) as any;
      const replies = (body.output?.rateReplyDetails ?? []) as any[];
      return replies.map((r) => ({
        carrier: 'fedex' as const,
        serviceLevel: String(r.serviceType ?? r.serviceName ?? 'fedex_ground').toLowerCase(),
        serviceDisplayName: r.serviceName ?? 'FedEx',
        amountMinor: Math.round((r.ratedShipmentDetails?.[0]?.totalNetCharge ?? 0) * 100),
        currency: r.ratedShipmentDetails?.[0]?.currency ?? input.currency,
        estimatedDeliveryDays: r.commit?.transitTime ? this.transitDays(r.commit.transitTime) : 4,
        raw: r,
      }));
    } catch (e) {
      this.logger.warn(`FedEx quote threw ${(e as Error).message}; mock fallback`);
      return this.mockOptions(input, true);
    }
  }

  async purchaseLabel(input: PurchaseInput): Promise<LabelResult> {
    if (!this.isLive()) return this.mockLabel(input);
    try {
      const token = await this.token();
      const res = await fetch(`${this.baseUrl}/ship/v1/shipments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-locale': 'en_US',
        },
        body: JSON.stringify({
          labelResponseOptions: 'LABEL',
          accountNumber: { value: this.accountNumber },
          requestedShipment: {
            ...this.toFedExShipment(input),
            serviceType: input.serviceLevel.toUpperCase(),
            labelSpecification: { imageType: 'PDF', labelStockType: 'PAPER_4X6' },
          },
        }),
      });
      if (!res.ok) {
        this.logger.warn(`FedEx ship failed (${res.status}); mock label`);
        return this.mockLabel(input);
      }
      const body = (await res.json()) as any;
      const piece = body.output?.transactionShipments?.[0];
      const pieceResponse = piece?.pieceResponses?.[0];
      const trackingNumber = pieceResponse?.trackingNumber ?? `FX-${ulid()}`;
      const base64 = pieceResponse?.packageDocuments?.[0]?.encodedLabel;
      const pdfBuffer = base64 ? Buffer.from(base64, 'base64') : await renderLabelPdf({
        carrierDisplayName: this.displayName,
        serviceDisplayName: input.serviceLevel,
        trackingNumber,
        input,
      });
      return {
        trackingNumber,
        serviceLevel: input.serviceLevel,
        labelPdf: pdfBuffer,
        labelMime: 'application/pdf',
        amountMinor: Math.round((piece?.completedShipmentDetail?.shipmentRating?.shipmentRateDetails?.[0]?.totalNetCharge ?? 0) * 100),
        currency: input.currency,
        raw: body,
      };
    } catch (e) {
      this.logger.warn(`FedEx ship threw ${(e as Error).message}; mock label`);
      return this.mockLabel(input);
    }
  }

  async track(trackingNumber: string): Promise<NormalizedEvent[]> {
    if (!this.isLive()) return [];
    try {
      const token = await this.token();
      const res = await fetch(`${this.baseUrl}/track/v1/trackingnumbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
          includeDetailedScans: true,
        }),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as any;
      const scans = body.output?.completeTrackResults?.[0]?.trackResults?.[0]?.scanEvents ?? [];
      return scans.map((s: any) => this.normalize(trackingNumber, s));
    } catch {
      return [];
    }
  }

  parseWebhook(_raw: Buffer, _headers: Record<string, string | string[] | undefined>): NormalizedEvent[] {
    // FedEx push tracking webhook payload — implement when production webhook is provisioned.
    return [];
  }

  // ----- helpers -----

  private async token(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
      return this.tokenCache.token;
    }
    const res = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.key!,
        client_secret: this.secret!,
      }),
    });
    if (!res.ok) throw new Error(`FedEx oauth failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private toFedExShipment(input: QuoteInput) {
    return {
      shipper: this.toFedExParty(input.origin),
      recipients: [this.toFedExParty(input.destination)],
      pickupType: 'USE_SCHEDULED_PICKUP',
      requestedPackageLineItems: [
        {
          weight: { units: 'KG', value: Math.max(0.1, input.weightGrams / 1000) },
          declaredValue: input.declaredValueMinor
            ? { amount: input.declaredValueMinor / 100, currency: input.currency }
            : undefined,
        },
      ],
    };
  }

  private toFedExParty(addr: QuoteInput['origin']) {
    return {
      contact: { personName: addr.fullName, phoneNumber: addr.phone ?? '0000000000' },
      address: {
        streetLines: [addr.line1, addr.line2].filter(Boolean),
        city: addr.city,
        stateOrProvinceCode: addr.region,
        postalCode: addr.postalCode,
        countryCode: addr.country,
      },
    };
  }

  private transitDays(t: string): number {
    const map: Record<string, number> = { ONE_DAY: 1, TWO_DAYS: 2, THREE_DAYS: 3, FOUR_DAYS: 4, FIVE_DAYS: 5, SIX_DAYS: 6, SEVEN_DAYS: 7 };
    return map[t] ?? 5;
  }

  private normalize(trackingNumber: string, scan: any): NormalizedEvent {
    const code = String(scan.eventType ?? '').toUpperCase();
    const map: Record<string, NormalizedEvent['code']> = {
      OC: 'label_created',
      PU: 'picked_up',
      AR: 'in_transit',
      IT: 'in_transit',
      OD: 'out_for_delivery',
      DL: 'delivered',
      DE: 'exception',
      CA: 'cancelled',
    };
    return {
      trackingNumber,
      code: map[code] ?? 'in_transit',
      label: scan.eventDescription ?? code,
      description: scan.exceptionDescription,
      locationCity: scan.scanLocation?.city,
      locationCountry: scan.scanLocation?.countryCode,
      occurredAt: scan.date ? new Date(scan.date) : new Date(),
      raw: scan,
    };
  }

  private mockOptions(input: QuoteInput, degraded = false): QuoteResult[] {
    return [
      mockQuote('fedex', 'FedEx', 'fedex_ground',    input, { baseMinor: 599,  perKgMinor: 250, days: 5, serviceDisplay: 'Ground' }),
      mockQuote('fedex', 'FedEx', 'fedex_2day',      input, { baseMinor: 1499, perKgMinor: 500, days: 2, serviceDisplay: '2Day' }),
      mockQuote('fedex', 'FedEx', 'fedex_overnight', input, { baseMinor: 2999, perKgMinor: 900, days: 1, serviceDisplay: 'Standard Overnight' }),
    ].map((q) => ({ ...q, degraded: degraded || q.degraded }));
  }

  private async mockLabel(input: PurchaseInput): Promise<LabelResult> {
    const opts = (await this.mockOptions(input)).find((o) => o.serviceLevel === input.serviceLevel)
              ?? (await this.mockOptions(input))[0]!;
    const trackingNumber = `FX-${ulid()}`;
    return {
      trackingNumber,
      serviceLevel: opts.serviceLevel,
      labelMime: 'application/pdf',
      labelPdf: await renderLabelPdf({
        carrierDisplayName: this.displayName,
        serviceDisplayName: opts.serviceDisplayName,
        trackingNumber,
        input,
      }),
      amountMinor: opts.amountMinor,
      currency: opts.currency,
      raw: { mock: true },
    };
  }
}
