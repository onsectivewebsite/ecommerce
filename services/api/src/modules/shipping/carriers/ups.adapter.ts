import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import type { CarrierAdapter, CarrierCode, LabelResult, NormalizedEvent, PurchaseInput, QuoteInput, QuoteResult } from './types';
import { mockQuote } from './pricing';
import { renderLabelPdf } from './label-pdf';

/**
 * UPS adapter — wraps UPS Rating, Shipping, and Tracking REST APIs.
 * Live mode requires: UPS_CLIENT_ID, UPS_CLIENT_SECRET, UPS_ACCOUNT_NUMBER
 * Falls back to deterministic mock pricing when keys are absent.
 */
@Injectable()
export class UpsAdapter implements CarrierAdapter {
  readonly code: CarrierCode = 'ups';
  readonly displayName = 'UPS';
  private readonly logger = new Logger(UpsAdapter.name);
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly accountNumber?: string;
  private readonly baseUrl: string;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(cfg: ConfigService) {
    this.clientId = cfg.get<string>('UPS_CLIENT_ID') || undefined;
    this.clientSecret = cfg.get<string>('UPS_CLIENT_SECRET') || undefined;
    this.accountNumber = cfg.get<string>('UPS_ACCOUNT_NUMBER') || undefined;
    this.baseUrl = cfg.get<string>('UPS_BASE_URL') ?? 'https://wwwcie.ups.com';
  }

  isLive(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.accountNumber);
  }

  async quote(input: QuoteInput): Promise<QuoteResult[]> {
    if (!this.isLive()) return this.mockOptions(input);
    try {
      const token = await this.token();
      const res = await fetch(`${this.baseUrl}/api/rating/v2403/Rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ RateRequest: this.toUpsRequest(input) }),
      });
      if (!res.ok) {
        this.logger.warn(`UPS quote failed (${res.status}); mock fallback`);
        return this.mockOptions(input, true);
      }
      const body = (await res.json()) as any;
      const services = (body.RateResponse?.RatedShipment ?? []) as any[];
      return services.map((s) => ({
        carrier: 'ups' as const,
        serviceLevel: this.upsServiceCode(s.Service?.Code) ?? 'ups_ground',
        serviceDisplayName: s.Service?.Description ?? 'UPS',
        amountMinor: Math.round(Number(s.TotalCharges?.MonetaryValue ?? 0) * 100),
        currency: s.TotalCharges?.CurrencyCode ?? input.currency,
        estimatedDeliveryDays: Number(s.GuaranteedDelivery?.BusinessDaysInTransit ?? 4),
        raw: s,
      }));
    } catch (e) {
      this.logger.warn(`UPS quote threw ${(e as Error).message}; mock fallback`);
      return this.mockOptions(input, true);
    }
  }

  async purchaseLabel(input: PurchaseInput): Promise<LabelResult> {
    if (!this.isLive()) return this.mockLabel(input);
    try {
      const token = await this.token();
      const res = await fetch(`${this.baseUrl}/api/shipments/v2403/ship`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ShipmentRequest: {
            Shipment: this.toUpsRequest(input).Shipment,
            LabelSpecification: { LabelImageFormat: { Code: 'PDF' }, LabelStockSize: { Height: '6', Width: '4' } },
          },
        }),
      });
      if (!res.ok) return this.mockLabel(input);
      const body = (await res.json()) as any;
      const result = body.ShipmentResponse?.ShipmentResults;
      const trackingNumber = result?.PackageResults?.[0]?.TrackingNumber ?? `UPS-${ulid()}`;
      const base64 = result?.PackageResults?.[0]?.ShippingLabel?.GraphicImage;
      const pdfBuffer = base64
        ? Buffer.from(base64, 'base64')
        : await renderLabelPdf({
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
        amountMinor: Math.round(Number(result?.ShipmentCharges?.TotalCharges?.MonetaryValue ?? 0) * 100),
        currency: input.currency,
        raw: body,
      };
    } catch {
      return this.mockLabel(input);
    }
  }

  async track(trackingNumber: string): Promise<NormalizedEvent[]> {
    if (!this.isLive()) return [];
    try {
      const token = await this.token();
      const res = await fetch(`${this.baseUrl}/api/track/v1/details/${trackingNumber}`, {
        headers: { Authorization: `Bearer ${token}`, transId: ulid(), transactionSrc: 'onsective' },
      });
      if (!res.ok) return [];
      const body = (await res.json()) as any;
      const activities = body.trackResponse?.shipment?.[0]?.package?.[0]?.activity ?? [];
      return activities.map((a: any) => this.normalize(trackingNumber, a));
    } catch { return []; }
  }

  parseWebhook(_raw: Buffer): NormalizedEvent[] { return []; }

  private async token(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) return this.tokenCache.token;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(`${this.baseUrl}/security/v1/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`UPS oauth failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in) * 1000 };
    return body.access_token;
  }

  private toUpsRequest(input: QuoteInput) {
    return {
      Request: { RequestOption: 'Rate', TransactionReference: { CustomerContext: 'onsective' } },
      Shipment: {
        Shipper: this.toUpsParty(input.origin, true),
        ShipTo: this.toUpsParty(input.destination),
        ShipFrom: this.toUpsParty(input.origin),
        Service: { Code: '03', Description: 'UPS Ground' },
        Package: [{
          PackagingType: { Code: '02' },
          PackageWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: (input.weightGrams / 1000).toFixed(2) },
        }],
      },
    };
  }

  private toUpsParty(addr: QuoteInput['origin'], withAccount = false) {
    const base: any = {
      Name: addr.fullName,
      Phone: { Number: addr.phone ?? '0000000000' },
      Address: {
        AddressLine: [addr.line1, addr.line2].filter(Boolean),
        City: addr.city,
        StateProvinceCode: addr.region,
        PostalCode: addr.postalCode,
        CountryCode: addr.country,
      },
    };
    if (withAccount && this.accountNumber) base.ShipperNumber = this.accountNumber;
    return base;
  }

  private upsServiceCode(code: string | undefined): string | null {
    const map: Record<string, string> = {
      '01': 'ups_next_day',
      '02': 'ups_2day',
      '03': 'ups_ground',
      '12': 'ups_3day',
      '13': 'ups_next_day_saver',
      '14': 'ups_next_day_early',
      '59': 'ups_2day_am',
    };
    return code ? map[code] ?? null : null;
  }

  private normalize(trackingNumber: string, a: any): NormalizedEvent {
    const status = String(a.status?.type ?? '').toLowerCase();
    const map: Record<string, NormalizedEvent['code']> = {
      m: 'label_created',
      p: 'picked_up',
      i: 'in_transit',
      o: 'out_for_delivery',
      d: 'delivered',
      x: 'exception',
    };
    return {
      trackingNumber,
      code: map[status[0] ?? ''] ?? 'in_transit',
      label: a.status?.description ?? 'In transit',
      description: a.status?.statusReason ?? undefined,
      locationCity: a.location?.address?.city,
      locationCountry: a.location?.address?.country,
      occurredAt: a.date && a.time ? new Date(`${a.date}T${a.time}`) : new Date(),
      raw: a,
    };
  }

  private mockOptions(input: QuoteInput, degraded = false): QuoteResult[] {
    return [
      mockQuote('ups', 'UPS', 'ups_ground',   input, { baseMinor: 549,  perKgMinor: 230, days: 5, serviceDisplay: 'Ground' }),
      mockQuote('ups', 'UPS', 'ups_3day',     input, { baseMinor: 1199, perKgMinor: 450, days: 3, serviceDisplay: '3 Day Select' }),
      mockQuote('ups', 'UPS', 'ups_next_day', input, { baseMinor: 2999, perKgMinor: 900, days: 1, serviceDisplay: 'Next Day Air' }),
    ].map((q) => ({ ...q, degraded: degraded || q.degraded }));
  }

  private async mockLabel(input: PurchaseInput): Promise<LabelResult> {
    const opt = (await this.mockOptions(input)).find((o) => o.serviceLevel === input.serviceLevel)
             ?? (await this.mockOptions(input))[0]!;
    const trackingNumber = `UPS-${ulid()}`;
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
