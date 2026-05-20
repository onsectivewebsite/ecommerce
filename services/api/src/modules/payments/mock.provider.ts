import { Injectable } from '@nestjs/common';
import type {
  PaymentGateway,
  PaymentIntentInput,
  PaymentIntentResult,
  PaymentWebhookEvent,
  RefundInput,
  RefundResult,
} from './gateway';
import type { PaymentProvider } from '@onsective/shared-types';

@Injectable()
export class MockPaymentProvider implements PaymentGateway {
  readonly provider: PaymentProvider = 'mock';

  async createIntent(input: PaymentIntentInput): Promise<PaymentIntentResult> {
    const ref = input.orderId ?? input.giftCardId ?? 'unknown';
    return {
      providerRef: `mock_${ref}_${Date.now()}`,
      clientSecret: null,
      raw: { mock: true, ...input },
    };
  }

  async capture(providerRef: string): Promise<{ raw: unknown }> {
    return { raw: { capturedAt: new Date().toISOString(), providerRef } };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      providerRefundId: `mock_refund_${input.providerRef}_${Date.now()}`,
      raw: { refundedAt: new Date().toISOString(), ...input },
    };
  }

  parseWebhook(): PaymentWebhookEvent {
    return { type: 'ignored', providerRef: '', raw: {} };
  }
}
