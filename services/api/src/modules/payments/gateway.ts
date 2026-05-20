import type { PaymentProvider } from '@onsective/shared-types';

export interface PaymentIntentInput {
  /**
   * The order this intent pays for. Optional because Phase 35 gift-card
   * purchases are not orders — exactly one of `orderId` / `giftCardId` is set.
   */
  orderId?: string;
  /** Phase 35: set for a gift-card purchase intent (mutually exclusive with orderId). */
  giftCardId?: string;
  amountMinor: number;
  currency: string;
  buyerEmail: string;
  /**
   * Phase 24: if set, the gateway will attempt an off-session capture
   * against this saved provider-side payment method id (Stripe pm_xxx) and
   * the associated customer. The order owner's customer id is resolved
   * by the gateway via `savedPaymentCustomerId`.
   */
  savedPaymentMethodId?: string;
  savedPaymentCustomerId?: string;
}

export interface PaymentIntentResult {
  providerRef: string;
  clientSecret?: string | null;
  /**
   * Phase 24: set when an off-session attempt succeeded and the order is
   * already captured. Lets the caller skip the "wait for webhook" path
   * in tests or fast-confirm UX.
   */
  capturedOffSession?: boolean;
  raw?: Record<string, unknown>;
}

/**
 * Phase 24: thrown by a gateway when an off-session capture is rejected
 * because the card needs the buyer to authenticate (3DS). The caller
 * relays the `clientSecret` back to the client so it can complete the
 * step-up via Stripe Elements.
 */
export class PaymentAuthenticationRequiredError extends Error {
  constructor(
    public readonly providerRef: string,
    public readonly clientSecret: string,
  ) {
    super('Authentication required');
    this.name = 'PaymentAuthenticationRequiredError';
  }
}

export interface PaymentWebhookEvent {
  type:
    | 'payment_captured'
    | 'payment_failed'
    | 'payment_refunded'
    | 'payment_disputed'
    | 'subscription_invoice_paid'
    | 'subscription_invoice_failed'
    | 'subscription_updated'
    | 'subscription_deleted'
    | 'connect_account_updated'
    | 'ignored';
  providerRef: string;
  orderId?: string;
  /** Phase 35: set on payment_captured / payment_failed for a gift-card purchase intent. */
  giftCardId?: string;
  /** Set on payment_disputed when known: chargeback reason code from the network. */
  disputeReason?: string;
  /** Set on payment_disputed: amount under dispute in minor units (may be < total). */
  disputeAmountMinor?: number;
  /** Phase 23: provider-side unique event id (e.g., evt_xxx) used for idempotency. */
  providerEventId?: string;
  /** Phase 23: provider subscription id (sub_xxx) on subscription_* events. */
  subscriptionId?: string;
  /** Phase 23: customer id on subscription_* events (cus_xxx). */
  customerId?: string;
  /** Phase 23: current_period_end on the subscription, ISO timestamp. */
  currentPeriodEnd?: Date;
  /** Phase 23: amount paid on invoice in minor units. */
  amountMinor?: number;
  /** Phase 23: currency on invoice. */
  currency?: string;
  /** Phase 23: whether the subscription is scheduled to cancel at period end. */
  cancelAtPeriodEnd?: boolean;
  raw: unknown;
}

export interface RefundInput {
  providerRef: string;
  amountMinor: number;
  currency: string;
  reason?: string;
}

export interface RefundResult {
  providerRefundId: string;
  raw: unknown;
}

export interface PaymentGateway {
  readonly provider: PaymentProvider;
  createIntent(input: PaymentIntentInput): Promise<PaymentIntentResult>;
  /**
   * Server-driven capture (used by Mock provider; Stripe captures via webhook).
   * Throws if the provider doesn't support manual capture.
   */
  capture?(providerRef: string): Promise<{ raw: unknown }>;
  /**
   * Phase 9: refund a previously-captured payment. Partial refunds supported when
   * amountMinor < the original. Webhook providers (Stripe) emit `payment_refunded`
   * which `PaymentsService.handleWebhook` already plumbs into `order.refunded`.
   */
  refund(input: RefundInput): Promise<RefundResult>;
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentWebhookEvent;
}

export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS');
