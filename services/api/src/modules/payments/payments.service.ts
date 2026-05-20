import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENT_GATEWAYS, type PaymentGateway } from './gateway';
import type { PaymentProvider } from '@onsective/shared-types';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAYS) private readonly gateways: PaymentGateway[],
    private readonly events: EventEmitter2,
  ) {}

  resolve(provider: PaymentProvider): PaymentGateway {
    const gw = this.gateways.find((g) => g.provider === provider);
    if (!gw) throw new BadRequestException(`Unsupported payment provider: ${provider}`);
    return gw;
  }

  async captureMock(orderId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.provider !== 'mock') throw new BadRequestException('Not a mock payment');
    if (payment.status === 'CAPTURED') return payment;
    const gw = this.resolve('mock');
    const result = await gw.capture!(payment.providerRef ?? payment.id);
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'CAPTURED', raw: result.raw as object },
    });
    await this.prisma.order.update({ where: { id: orderId }, data: { status: 'PAID' } });
    this.events.emit('order.paid', { orderId });
    return this.prisma.payment.findUnique({ where: { orderId } });
  }

  /**
   * Phase 9: refund a previously-captured payment via the original provider.
   * Partial refunds supported. Emits `order.refunded` once on full refund so the
   * commission booker reverses cleanly; partials emit `order.refunded.partial`
   * with the refunded amount so listeners can decide their own treatment.
   * Returns the refund row id from the provider for audit linkage.
   */
  async refundOrder(orderId: string, amountMinor: number, reason?: string) {
    const payment = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'CAPTURED' && payment.status !== 'REFUNDED') {
      throw new BadRequestException(`Cannot refund payment in status ${payment.status}`);
    }
    if (amountMinor <= 0 || amountMinor > payment.amountMinor) {
      throw new BadRequestException('Refund amount out of range');
    }
    const gw = this.resolve(payment.provider as PaymentProvider);
    const result = await gw.refund({
      providerRef: payment.providerRef ?? '',
      amountMinor,
      currency: payment.currency,
      reason,
    });

    const isFull = amountMinor === payment.amountMinor;
    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: isFull ? 'REFUNDED' : payment.status,
          raw: { ...(payment.raw as object), lastRefund: result.raw } as object,
        },
      }),
      ...(isFull
        ? [this.prisma.order.update({ where: { id: orderId }, data: { status: 'REFUNDED' } })]
        : []),
    ]);

    if (isFull) {
      this.events.emit('order.refunded', { orderId });
    } else {
      this.events.emit('order.refunded.partial', { orderId, amountMinor });
    }
    return { providerRefundId: result.providerRefundId, full: isFull };
  }

  async handleWebhook(provider: PaymentProvider, raw: Buffer, headers: Record<string, string | string[] | undefined>) {
    const gw = this.resolve(provider);
    const evt = gw.parseWebhook(raw, headers);
    if (evt.type === 'ignored') return { ok: true, ignored: true };

    // Phase 23: subscription-lifecycle events have no Payment row to look
    // up. Emit a domain event keyed by Stripe subscription id and let the
    // loyalty MembershipBillingListener apply it. Idempotency is enforced
    // on the receiving side via the MembershipBillingEvent.providerEventId
    // unique constraint.
    if (
      evt.type === 'subscription_invoice_paid' ||
      evt.type === 'subscription_invoice_failed' ||
      evt.type === 'subscription_updated' ||
      evt.type === 'subscription_deleted'
    ) {
      this.events.emit(`membership.${evt.type}`, {
        providerEventId: evt.providerEventId,
        subscriptionId: evt.subscriptionId,
        customerId: evt.customerId,
        currentPeriodEnd: evt.currentPeriodEnd,
        amountMinor: evt.amountMinor,
        currency: evt.currency,
        cancelAtPeriodEnd: evt.cancelAtPeriodEnd,
      });
      return { ok: true, subscription: true };
    }

    // Phase 29: Stripe Connect account state changed. Emit a domain event
    // so SellerOnboardingService can re-sync the local mirror without
    // PaymentsService importing the payouts module.
    if (evt.type === 'connect_account_updated') {
      this.events.emit('seller.connect.account_updated', {
        providerEventId: evt.providerEventId,
        stripeAccountId: evt.providerRef,
      });
      return { ok: true, connect: true };
    }

    // Phase 35: a gift-card purchase intent has no order-keyed Payment row.
    // Route it by the giftCardId stamped into the PI metadata; the
    // GiftCardPurchaseListener applies the state change.
    if (evt.giftCardId) {
      if (evt.type === 'payment_captured') {
        this.events.emit('giftcard.purchase.paid', {
          giftCardId: evt.giftCardId,
          providerRef: evt.providerRef,
        });
      } else if (evt.type === 'payment_failed') {
        this.events.emit('giftcard.purchase.failed', {
          giftCardId: evt.giftCardId,
          providerRef: evt.providerRef,
        });
      }
      return { ok: true, giftCard: true };
    }

    const payment = await this.prisma.payment.findFirst({
      where: { provider, providerRef: evt.providerRef },
    });
    if (!payment) {
      return { ok: true, ignored: true, reason: 'unknown providerRef' };
    }

    if (evt.type === 'payment_captured' && payment.status !== 'CAPTURED') {
      await this.prisma.$transaction([
        this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'CAPTURED', raw: evt.raw as object } }),
        this.prisma.order.update({ where: { id: payment.orderId }, data: { status: 'PAID' } }),
      ]);
      this.events.emit('order.paid', { orderId: payment.orderId });
    } else if (evt.type === 'payment_failed') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', raw: evt.raw as object },
      });
    } else if (evt.type === 'payment_refunded') {
      await this.prisma.$transaction([
        this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED', raw: evt.raw as object } }),
        this.prisma.order.update({ where: { id: payment.orderId }, data: { status: 'REFUNDED' } }),
      ]);
    } else if (evt.type === 'payment_disputed') {
      // Card network chargeback. Funds are already debited by the issuer; we just
      // record it so the disputes module can open a CHARGEBACK case and admin can
      // respond with evidence (or accept and reverse the booked commission).
      this.events.emit('payment.disputed', {
        orderId: payment.orderId,
        paymentId: payment.id,
        amountMinor: evt.disputeAmountMinor ?? payment.amountMinor,
        reason: evt.disputeReason,
      });
    }
    return { ok: true };
  }
}
