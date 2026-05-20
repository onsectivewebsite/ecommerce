import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationFeedService } from '../notification-feed/notification-feed.service';
import { MembershipService } from './membership.service';

interface SubscriptionEventPayload {
  providerEventId?: string;
  subscriptionId?: string;
  amountMinor?: number;
  currency?: string;
}

function formatMoneyMinor(amountMinor: number | undefined, currency: string | undefined) {
  if (typeof amountMinor !== 'number' || !currency) return '';
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Phase 24: emails the buyer on the three Plus lifecycle events. We
 * deliberately don't piggy-back on the MembershipBillingListener — that
 * one's job is to mutate state idempotently, while this one's job is to
 * notify. Both subscribe to the same source events so a webhook drop on
 * one is independent of the other.
 */
@Injectable()
export class PlusNotificationsListener {
  private readonly logger = new Logger(PlusNotificationsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly membership: MembershipService,
    private readonly feed: NotificationFeedService,
    private readonly cfg: ConfigService,
  ) {}

  private membershipUrl(): string {
    const base = this.cfg.get<string>('BUYER_WEB_URL') ?? 'http://localhost:3000';
    return `${base}/account/membership`;
  }

  private paymentMethodsUrl(): string {
    const base = this.cfg.get<string>('BUYER_WEB_URL') ?? 'http://localhost:3000';
    return `${base}/account/payment-methods`;
  }

  @OnEvent('membership.subscription_invoice_paid')
  async onRenewed(payload: SubscriptionEventPayload) {
    if (!payload?.subscriptionId) return;
    const row = await this.membership.getBySubscriptionId(payload.subscriptionId);
    if (!row) return;
    try {
      const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
      if (!user) return;
      await this.email.sendToUser(row.userId, 'plus_renewed', {
        firstName: user.firstName,
        plan: row.plan === 'PLUS_ANNUAL' ? 'annual' : 'monthly',
        priceFormatted: formatMoneyMinor(payload.amountMinor, payload.currency) || formatMoneyMinor(row.pricePaidMinor, row.currency),
        nextRenewal: fmtDate(row.currentPeriodEnd ?? row.expiresAt),
        membershipUrl: this.membershipUrl(),
      });
      await this.feed.write({
        userId: row.userId,
        kind: NotificationKind.PLUS_RENEWED,
        title: 'Plus membership renewed',
        body: `Your ${row.plan === 'PLUS_ANNUAL' ? 'annual' : 'monthly'} Onsective Plus renewed. Next renewal ${fmtDate(row.currentPeriodEnd ?? row.expiresAt)}.`,
        deepLinkPath: '/account/membership',
      });
    } catch (e) {
      this.logger.warn(`plus_renewed email failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('membership.subscription_invoice_failed')
  async onPaymentFailed(payload: SubscriptionEventPayload) {
    if (!payload?.subscriptionId) return;
    const row = await this.membership.getBySubscriptionId(payload.subscriptionId);
    if (!row) return;
    try {
      const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
      if (!user) return;
      await this.email.sendToUser(row.userId, 'plus_payment_failed', {
        firstName: user.firstName,
        paymentMethodsUrl: this.paymentMethodsUrl(),
      });
      await this.feed.write({
        userId: row.userId,
        kind: NotificationKind.PLUS_PAYMENT_FAILED,
        title: 'Plus payment failed',
        body: 'We couldn\'t charge your card. Plus benefits are paused — update your card to resume.',
        deepLinkPath: '/account/payment-methods',
      });
    } catch (e) {
      this.logger.warn(`plus_payment_failed email failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('membership.subscription_deleted')
  async onExpired(payload: SubscriptionEventPayload) {
    if (!payload?.subscriptionId) return;
    const row = await this.membership.getBySubscriptionId(payload.subscriptionId);
    if (!row) return;
    try {
      const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
      if (!user) return;
      await this.email.sendToUser(row.userId, 'plus_expired', {
        firstName: user.firstName,
        membershipUrl: this.membershipUrl(),
      });
      await this.feed.write({
        userId: row.userId,
        kind: NotificationKind.PLUS_EXPIRED,
        title: 'Plus membership ended',
        body: 'Your Onsective Plus membership has ended. You can rejoin any time.',
        deepLinkPath: '/account/membership',
      });
    } catch (e) {
      this.logger.warn(`plus_expired email failed: ${(e as Error).message}`);
    }
  }
}
