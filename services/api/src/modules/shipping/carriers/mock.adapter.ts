import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import type { CarrierAdapter, CarrierCode, LabelResult, NormalizedEvent, PurchaseInput, QuoteInput, QuoteResult } from './types';
import { mockQuote } from './pricing';
import { renderLabelPdf } from './label-pdf';

@Injectable()
export class MockCarrierAdapter implements CarrierAdapter {
  readonly code: CarrierCode = 'mock';
  readonly displayName = 'Onsective Mock Carrier';

  isLive(): boolean { return true; } // mock is always "live"

  async quote(input: QuoteInput): Promise<QuoteResult[]> {
    return [
      mockQuote('mock', 'Mock', 'standard', input, { baseMinor: 399, perKgMinor: 200, days: 5, serviceDisplay: 'Standard' }),
      mockQuote('mock', 'Mock', 'express',  input, { baseMinor: 999, perKgMinor: 400, days: 2, serviceDisplay: 'Express' }),
    ].map((q) => ({ ...q, degraded: false }));
  }

  async purchaseLabel(input: PurchaseInput): Promise<LabelResult> {
    const trackingNumber = `MOCK-${ulid()}`;
    const q = (await this.quote(input)).find((x) => x.serviceLevel === input.serviceLevel)
            ?? (await this.quote(input))[0]!;
    const pdf = await renderLabelPdf({
      carrierDisplayName: this.displayName,
      serviceDisplayName: q.serviceDisplayName,
      trackingNumber,
      input,
    });
    return {
      trackingNumber,
      serviceLevel: q.serviceLevel,
      labelPdf: pdf,
      labelMime: 'application/pdf',
      amountMinor: q.amountMinor,
      currency: q.currency,
      raw: { mock: true },
    };
  }

  async track(trackingNumber: string): Promise<NormalizedEvent[]> {
    return [
      {
        trackingNumber,
        code: 'label_created',
        label: 'Label created',
        occurredAt: new Date(),
        raw: { mock: true },
      },
    ];
  }

  parseWebhook(): NormalizedEvent[] { return []; }
}
