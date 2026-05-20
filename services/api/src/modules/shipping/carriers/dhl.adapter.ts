import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import type { CarrierAdapter, CarrierCode, LabelResult, NormalizedEvent, PurchaseInput, QuoteInput, QuoteResult } from './types';
import { mockQuote } from './pricing';
import { renderLabelPdf } from './label-pdf';

/**
 * DHL Express adapter — MyDHL API v2.
 * Live mode requires: DHL_API_KEY, DHL_API_SECRET, DHL_ACCOUNT_NUMBER
 */
@Injectable()
export class DhlAdapter implements CarrierAdapter {
  readonly code: CarrierCode = 'dhl';
  readonly displayName = 'DHL Express';
  private readonly logger = new Logger(DhlAdapter.name);
  private readonly key?: string;
  private readonly secret?: string;
  private readonly accountNumber?: string;
  private readonly baseUrl: string;

  constructor(cfg: ConfigService) {
    this.key = cfg.get<string>('DHL_API_KEY') || undefined;
    this.secret = cfg.get<string>('DHL_API_SECRET') || undefined;
    this.accountNumber = cfg.get<string>('DHL_ACCOUNT_NUMBER') || undefined;
    this.baseUrl = cfg.get<string>('DHL_BASE_URL') ?? 'https://express.api.dhl.com/mydhlapi/test';
  }

  isLive(): boolean {
    return Boolean(this.key && this.secret && this.accountNumber);
  }

  private basicAuth(): string {
    return 'Basic ' + Buffer.from(`${this.key}:${this.secret}`).toString('base64');
  }

  async quote(input: QuoteInput): Promise<QuoteResult[]> {
    if (!this.isLive()) return this.mockOptions(input);
    try {
      const res = await fetch(`${this.baseUrl}/rates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.basicAuth() },
        body: JSON.stringify({
          customerDetails: {
            shipperDetails: this.toDhlParty(input.origin),
            receiverDetails: this.toDhlParty(input.destination),
          },
          accounts: [{ typeCode: 'shipper', number: this.accountNumber }],
          plannedShippingDateAndTime: new Date().toISOString(),
          unitOfMeasurement: 'metric',
          isCustomsDeclarable: input.origin.country !== input.destination.country,
          packages: [{ weight: Math.max(0.1, input.weightGrams / 1000) }],
        }),
      });
      if (!res.ok) {
        this.logger.warn(`DHL quote failed (${res.status}); mock fallback`);
        return this.mockOptions(input, true);
      }
      const body = (await res.json()) as any;
      const products = (body.products ?? []) as any[];
      return products.map((p) => ({
        carrier: 'dhl' as const,
        serviceLevel: `dhl_${String(p.productCode ?? 'P').toLowerCase()}`,
        serviceDisplayName: p.productName ?? 'DHL Express',
        amountMinor: Math.round(Number(p.totalPrice?.[0]?.price ?? 0) * 100),
        currency: p.totalPrice?.[0]?.priceCurrency ?? input.currency,
        estimatedDeliveryDays: 3,
        raw: p,
      }));
    } catch (e) {
      this.logger.warn(`DHL quote threw ${(e as Error).message}; mock fallback`);
      return this.mockOptions(input, true);
    }
  }

  async purchaseLabel(input: PurchaseInput): Promise<LabelResult> {
    if (!this.isLive()) return this.mockLabel(input);
    try {
      const res = await fetch(`${this.baseUrl}/shipments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.basicAuth() },
        body: JSON.stringify({
          plannedShippingDateAndTime: new Date().toISOString(),
          pickup: { isRequested: false },
          productCode: input.serviceLevel.replace(/^dhl_/, '').toUpperCase(),
          accounts: [{ typeCode: 'shipper', number: this.accountNumber }],
          customerDetails: {
            shipperDetails: this.toDhlParty(input.origin),
            receiverDetails: this.toDhlParty(input.destination),
          },
          content: {
            packages: [{ weight: Math.max(0.1, input.weightGrams / 1000), description: 'Onsective order' }],
            isCustomsDeclarable: input.origin.country !== input.destination.country,
            description: `Order ${input.orderId}`,
            incoterm: 'DAP',
            unitOfMeasurement: 'metric',
          },
        }),
      });
      if (!res.ok) return this.mockLabel(input);
      const body = (await res.json()) as any;
      const trackingNumber = body.shipmentTrackingNumber ?? `DHL-${ulid()}`;
      const docB64 = body.documents?.[0]?.content;
      const pdfBuffer = docB64
        ? Buffer.from(docB64, 'base64')
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
        amountMinor: 0,
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
      const res = await fetch(`${this.baseUrl}/tracking?shipmentTrackingNumber=${trackingNumber}`, {
        headers: { Authorization: this.basicAuth() },
      });
      if (!res.ok) return [];
      const body = (await res.json()) as any;
      const events = body.shipments?.[0]?.events ?? [];
      return events.map((e: any) => this.normalize(trackingNumber, e));
    } catch { return []; }
  }

  parseWebhook(_raw: Buffer): NormalizedEvent[] { return []; }

  private toDhlParty(addr: QuoteInput['origin']) {
    return {
      postalAddress: {
        cityName: addr.city,
        countryCode: addr.country,
        postalCode: addr.postalCode,
        addressLine1: addr.line1,
        addressLine2: addr.line2 ?? undefined,
        provinceCode: addr.region,
      },
      contactInformation: { phone: addr.phone ?? '0000000000', companyName: addr.fullName, fullName: addr.fullName },
    };
  }

  private normalize(trackingNumber: string, e: any): NormalizedEvent {
    const status = String(e.typeCode ?? '').toUpperCase();
    const map: Record<string, NormalizedEvent['code']> = {
      PU: 'picked_up',
      DF: 'in_transit',
      AR: 'in_transit',
      WC: 'out_for_delivery',
      OK: 'delivered',
      EXC: 'exception',
    };
    return {
      trackingNumber,
      code: map[status] ?? 'in_transit',
      label: e.description ?? 'Update',
      description: e.serviceArea?.[0]?.description,
      locationCity: e.location?.address?.cityName,
      locationCountry: e.location?.address?.countryCode,
      occurredAt: e.date ? new Date(`${e.date}T${e.time ?? '00:00:00'}`) : new Date(),
      raw: e,
    };
  }

  private mockOptions(input: QuoteInput, degraded = false): QuoteResult[] {
    return [
      mockQuote('dhl', 'DHL', 'dhl_express_worldwide', input, { baseMinor: 1899, perKgMinor: 850, days: 3, serviceDisplay: 'Express Worldwide' }),
    ].map((q) => ({ ...q, degraded: degraded || q.degraded }));
  }

  private async mockLabel(input: PurchaseInput): Promise<LabelResult> {
    const opt = (await this.mockOptions(input)).find((o) => o.serviceLevel === input.serviceLevel)
             ?? (await this.mockOptions(input))[0]!;
    const trackingNumber = `DHL-${ulid()}`;
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
