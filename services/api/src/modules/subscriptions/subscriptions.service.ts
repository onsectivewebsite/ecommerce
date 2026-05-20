import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { PaymentProvider } from '@onsective/shared-types';
import type { SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { PaymentsService } from '../payments/payments.service';
import { TIERS, tierHas, tierAllowsProductCount, type TierDefinition, type TierFeature } from './tiers';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  listTiers(): TierDefinition[] {
    return [TIERS.BASIC, TIERS.PRO, TIERS.ENTERPRISE];
  }

  async getMine(userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('No seller profile');
    let sub = await this.prisma.sellerSubscription.findUnique({ where: { sellerId: seller.id } });
    if (!sub) {
      sub = await this.prisma.sellerSubscription.create({
        data: { id: newId(), sellerId: seller.id, tier: 'BASIC', status: 'ACTIVE' },
      });
    }
    return { ...sub, definition: TIERS[sub.tier] };
  }

  async start(userId: string, tier: SubscriptionTier, provider: PaymentProvider) {
    if (tier === 'BASIC') {
      const seller = await this.prisma.seller.findUnique({ where: { userId } });
      if (!seller) throw new NotFoundException('No seller profile');
      await this.activate(seller.id, 'BASIC');
      return { instant: true, paymentRef: null };
    }
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('No seller profile');
    const def = TIERS[tier];
    const gateway = this.payments.resolve(provider);
    const intent = await gateway.createIntent({
      orderId: `sub_${seller.id}_${Date.now()}`,
      amountMinor: def.monthlyPriceMinor,
      currency: def.currency,
      buyerEmail: 'subscriptions@onsective.com',
    });
    // Stash the pending intent on the subscription row for the webhook to flip.
    await this.prisma.sellerSubscription.upsert({
      where: { sellerId: seller.id },
      update: { tier, status: 'PAST_DUE', lastPaymentId: intent.providerRef },
      create: {
        id: newId(),
        sellerId: seller.id,
        tier,
        status: 'PAST_DUE',
        lastPaymentId: intent.providerRef,
      },
    });
    // Mock provider: capture inline so the dev flow lights up immediately.
    if (provider === 'mock') {
      await this.activate(seller.id, tier, intent.providerRef);
      return { instant: true, paymentRef: intent.providerRef, clientSecret: null };
    }
    return { instant: false, paymentRef: intent.providerRef, clientSecret: intent.clientSecret ?? null };
  }

  async cancel(userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('No seller profile');
    const sub = await this.prisma.sellerSubscription.findUnique({ where: { sellerId: seller.id } });
    if (!sub) throw new NotFoundException('No subscription');
    if (sub.status === 'CANCELLED') return sub;
    return this.prisma.sellerSubscription.update({
      where: { sellerId: seller.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), tier: 'BASIC' },
    });
  }

  private async activate(sellerId: string, tier: SubscriptionTier, paymentRef?: string) {
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return this.prisma.sellerSubscription.upsert({
      where: { sellerId },
      update: {
        tier,
        status: 'ACTIVE',
        currentPeriodEnd: periodEnd,
        lastPaymentId: paymentRef,
        cancelledAt: null,
      },
      create: {
        id: newId(),
        sellerId,
        tier,
        status: 'ACTIVE',
        currentPeriodEnd: periodEnd,
        lastPaymentId: paymentRef,
      },
    });
  }

  // ---- guards used elsewhere ----

  async requireFeature(userId: string, feature: Exclude<TierFeature, 'maxActiveProducts'>): Promise<void> {
    const sub = await this.getMine(userId);
    if (!tierHas(sub.tier, feature)) {
      throw new BadRequestException(`Feature "${feature}" requires a higher subscription tier (current: ${sub.tier})`);
    }
  }

  async requireProductRoom(userId: string): Promise<void> {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('No seller profile');
    const sub = await this.getMine(userId);
    const count = await this.prisma.product.count({
      where: { sellerId: seller.id, status: { in: ['ACTIVE', 'DRAFT'] } },
    });
    if (!tierAllowsProductCount(sub.tier, count + 1)) {
      throw new ConflictException(`Your tier allows at most ${TIERS[sub.tier].features.maxActiveProducts} products`);
    }
  }

  // Auto-activate when a subscription payment_intent captures via webhook.
  @OnEvent('order.paid')
  async maybeActivateOnPayment(payload: { orderId: string }) {
    // Subscription intents use synthetic order ids like `sub_<sellerId>_<ts>`; ignore real orders.
    if (!payload.orderId.startsWith('sub_')) return;
    const [, sellerId] = payload.orderId.split('_');
    if (!sellerId) return;
    const sub = await this.prisma.sellerSubscription.findUnique({ where: { sellerId } });
    if (!sub) return;
    await this.activate(sellerId, sub.tier, sub.lastPaymentId ?? undefined);
    this.logger.log(`Subscription activated for seller=${sellerId} tier=${sub.tier}`);
  }
}
