import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  PaymentAuthenticationRequiredError,
  type PaymentGateway,
  type PaymentIntentInput,
  type PaymentIntentResult,
  type PaymentWebhookEvent,
  type RefundInput,
  type RefundResult,
} from './gateway';
import type { PaymentProvider } from '@onsective/shared-types';

/**
 * Phase 35: a PaymentIntent pays for either an order or a gift-card purchase.
 * We stamp exactly one id into the PI metadata so the webhook can route the
 * capture to the right handler.
 */
function intentMetadata(input: PaymentIntentInput): Record<string, string> {
  if (input.giftCardId) return { giftCardId: input.giftCardId };
  if (input.orderId) return { orderId: input.orderId };
  return {};
}

@Injectable()
export class StripePaymentProvider implements PaymentGateway {
  readonly provider: PaymentProvider = 'stripe';
  private readonly logger = new Logger(StripePaymentProvider.name);
  private readonly stripe: Stripe | null;
  private readonly webhookSecret: string;

  constructor(private readonly cfg: ConfigService) {
    const key = cfg.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = cfg.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    this.stripe = key ? new Stripe(key, { apiVersion: '2024-06-20' }) : null;
    if (!this.stripe) {
      this.logger.warn('STRIPE_SECRET_KEY missing — Stripe provider will reject createIntent calls');
    }
  }

  /** Whether Stripe is configured (used by callers to bail out early in dev). */
  isConfigured(): boolean {
    return !!this.stripe;
  }

  private requireStripe(): Stripe {
    if (!this.stripe) throw new Error('Stripe is not configured');
    return this.stripe;
  }

  // ---------------- Phase 23: customers + saved methods ----------------

  async createCustomer(input: { email?: string; userId: string }): Promise<string> {
    const s = this.requireStripe();
    const c = await s.customers.create({
      email: input.email,
      metadata: { onsective_user_id: input.userId },
    });
    return c.id;
  }

  async createSetupIntent(customerId: string): Promise<{ id: string; clientSecret: string }> {
    const s = this.requireStripe();
    const si = await s.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
    });
    if (!si.client_secret) throw new Error('Stripe returned no client_secret');
    return { id: si.id, clientSecret: si.client_secret };
  }

  async resolveSetupIntent(setupIntentId: string): Promise<{
    customerId: string;
    paymentMethodId: string;
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  }> {
    const s = this.requireStripe();
    const si = await s.setupIntents.retrieve(setupIntentId);
    if (si.status !== 'succeeded') throw new Error(`SetupIntent not confirmed (status=${si.status})`);
    const customerId = typeof si.customer === 'string' ? si.customer : si.customer?.id;
    const pmId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
    if (!customerId || !pmId) throw new Error('SetupIntent missing customer or payment method');
    const pm = await s.paymentMethods.retrieve(pmId);
    const card = pm.card;
    if (!card) throw new Error('Payment method is not a card');
    return {
      customerId,
      paymentMethodId: pm.id,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.exp_month,
      expYear: card.exp_year,
    };
  }

  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    const s = this.requireStripe();
    await s.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    const s = this.requireStripe();
    await s.paymentMethods.detach(paymentMethodId);
  }

  // ---------------- Phase 23: subscriptions ----------------

  async createSubscription(input: {
    customerId: string;
    priceId: string;
    metadata?: Record<string, string>;
  }): Promise<{ id: string; currentPeriodEnd: Date; status: string }> {
    const s = this.requireStripe();
    const sub = await s.subscriptions.create({
      customer: input.customerId,
      items: [{ price: input.priceId }],
      payment_behavior: 'error_if_incomplete',
      metadata: input.metadata,
      expand: ['latest_invoice.payment_intent'],
    });
    return {
      id: sub.id,
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      status: sub.status,
    };
  }

  async setSubscriptionAutoRenew(subscriptionId: string, autoRenew: boolean): Promise<{ currentPeriodEnd: Date }> {
    const s = this.requireStripe();
    const sub = await s.subscriptions.update(subscriptionId, {
      cancel_at_period_end: !autoRenew,
    });
    return { currentPeriodEnd: new Date(sub.current_period_end * 1000) };
  }

  async createIntent(input: PaymentIntentInput): Promise<PaymentIntentResult> {
    const stripe = this.requireStripe();

    // Phase 24: off-session capture against a saved card. Stripe takes the
    // payment immediately; if SCA is required, it returns a specific error
    // type that we map to PaymentAuthenticationRequiredError so the API can
    // forward the PaymentIntent.client_secret back to the buyer.
    if (input.savedPaymentMethodId && input.savedPaymentCustomerId) {
      try {
        const intent = await stripe.paymentIntents.create({
          amount: input.amountMinor,
          currency: input.currency.toLowerCase(),
          customer: input.savedPaymentCustomerId,
          payment_method: input.savedPaymentMethodId,
          off_session: true,
          confirm: true,
          metadata: intentMetadata(input),
          receipt_email: input.buyerEmail,
        });
        return {
          providerRef: intent.id,
          clientSecret: intent.client_secret,
          capturedOffSession: intent.status === 'succeeded',
          raw: { id: intent.id, status: intent.status },
        };
      } catch (e) {
        const err = e as Stripe.errors.StripeError;
        if (
          err?.type === 'StripeCardError' &&
          err.code === 'authentication_required' &&
          err.payment_intent?.client_secret
        ) {
          throw new PaymentAuthenticationRequiredError(
            err.payment_intent.id,
            err.payment_intent.client_secret,
          );
        }
        throw e;
      }
    }

    const intent = await stripe.paymentIntents.create({
      amount: input.amountMinor,
      currency: input.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: intentMetadata(input),
      receipt_email: input.buyerEmail,
    });
    return {
      providerRef: intent.id,
      clientSecret: intent.client_secret,
      raw: { id: intent.id, status: intent.status },
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (!this.stripe) throw new Error('Stripe is not configured');
    const refund = await this.stripe.refunds.create({
      payment_intent: input.providerRef,
      amount: input.amountMinor,
      reason: this.mapReason(input.reason),
      metadata: input.reason ? { onsective_reason: input.reason } : undefined,
    });
    return { providerRefundId: refund.id, raw: { id: refund.id, status: refund.status } };
  }

  private mapReason(reason?: string): Stripe.RefundCreateParams.Reason | undefined {
    if (!reason) return undefined;
    const r = reason.toLowerCase();
    if (r.includes('fraud')) return 'fraudulent';
    if (r.includes('duplicate')) return 'duplicate';
    // 'NOT_AS_DESCRIBED', 'DAMAGED', etc. are treated as 'requested_by_customer'.
    return 'requested_by_customer';
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentWebhookEvent {
    if (!this.stripe || !this.webhookSecret) {
      throw new Error('Stripe webhook is not configured');
    }
    const sig = (headers['stripe-signature'] ?? '') as string;
    const event = this.stripe.webhooks.constructEvent(rawBody, sig, this.webhookSecret);
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        return {
          type: 'payment_captured',
          providerRef: pi.id,
          orderId: (pi.metadata?.orderId as string | undefined) ?? undefined,
          giftCardId: (pi.metadata?.giftCardId as string | undefined) ?? undefined,
          raw: event,
        };
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        return {
          type: 'payment_failed',
          providerRef: pi.id,
          orderId: (pi.metadata?.orderId as string | undefined) ?? undefined,
          giftCardId: (pi.metadata?.giftCardId as string | undefined) ?? undefined,
          raw: event,
        };
      }
      case 'charge.refunded': {
        const ch = event.data.object as Stripe.Charge;
        return {
          type: 'payment_refunded',
          providerRef: (ch.payment_intent as string) ?? '',
          raw: event,
        };
      }
      case 'charge.dispute.created': {
        const d = event.data.object as Stripe.Dispute;
        return {
          type: 'payment_disputed',
          providerRef: (d.payment_intent as string) ?? '',
          disputeReason: d.reason,
          disputeAmountMinor: d.amount,
          raw: event,
        };
      }
      case 'invoice.paid': {
        const inv = event.data.object as Stripe.Invoice;
        const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
        if (!subId) return { type: 'ignored', providerRef: '', raw: event };
        return {
          type: 'subscription_invoice_paid',
          providerRef: inv.id,
          providerEventId: event.id,
          subscriptionId: subId,
          customerId: (typeof inv.customer === 'string' ? inv.customer : inv.customer?.id) ?? undefined,
          amountMinor: inv.amount_paid,
          currency: inv.currency.toUpperCase(),
          raw: event,
        };
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
        if (!subId) return { type: 'ignored', providerRef: '', raw: event };
        return {
          type: 'subscription_invoice_failed',
          providerRef: inv.id,
          providerEventId: event.id,
          subscriptionId: subId,
          customerId: (typeof inv.customer === 'string' ? inv.customer : inv.customer?.id) ?? undefined,
          amountMinor: inv.amount_due,
          currency: inv.currency.toUpperCase(),
          raw: event,
        };
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        return {
          type: 'subscription_updated',
          providerRef: sub.id,
          providerEventId: event.id,
          subscriptionId: sub.id,
          customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          raw: event,
        };
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        return {
          type: 'subscription_deleted',
          providerRef: sub.id,
          providerEventId: event.id,
          subscriptionId: sub.id,
          customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
          raw: event,
        };
      }
      case 'account.updated': {
        // Phase 29: Stripe Connect account state changed (KYC progressed,
        // requirements added/cleared, etc.). The handler is wired in the
        // payments-service webhook dispatcher and forwarded to the
        // SellerOnboardingService via a domain event.
        const acct = event.data.object as Stripe.Account;
        return {
          type: 'connect_account_updated',
          providerRef: acct.id,
          providerEventId: event.id,
          customerId: acct.id, // re-using the field; SellerOnboardingService keys off this
          raw: event,
        };
      }
      default:
        return { type: 'ignored', providerRef: '', raw: event };
    }
  }
}
