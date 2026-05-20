import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MembershipPlan,
  MembershipStatus,
  type PlusMembership,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import { PaymentMethodsService } from '../payments/payment-methods.service';
import { StripePaymentProvider } from '../payments/stripe.provider';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface StartMembershipInput {
  plan: MembershipPlan;
}

@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cfg: ConfigService,
    private readonly paymentMethods: PaymentMethodsService,
    private readonly stripe: StripePaymentProvider,
  ) {}

  private priceIdFor(plan: MembershipPlan): string {
    const key =
      plan === MembershipPlan.PLUS_ANNUAL
        ? 'LOYALTY_STRIPE_PRICE_ANNUAL'
        : 'LOYALTY_STRIPE_PRICE_MONTHLY';
    const priceId = this.cfg.get<string>(key);
    if (!priceId) {
      throw new BadRequestException(
        `Stripe price id not configured (${key}); set it in env to enable Plus.`,
      );
    }
    return priceId;
  }

  private priceFor(plan: MembershipPlan): number {
    if (plan === MembershipPlan.PLUS_ANNUAL) {
      return Number(this.cfg.get<string>('LOYALTY_PLUS_ANNUAL_MINOR') ?? '7900');
    }
    return Number(this.cfg.get<string>('LOYALTY_PLUS_MONTHLY_MINOR') ?? '999');
  }

  async getForUser(userId: string): Promise<PlusMembership | null> {
    const row = await this.prisma.plusMembership.findUnique({ where: { userId } });
    if (!row) return null;
    // Lazy expire: ACTIVE rows past their expiresAt flip to EXPIRED on read.
    if (row.status === MembershipStatus.ACTIVE && row.expiresAt.getTime() <= Date.now()) {
      return this.prisma.plusMembership.update({
        where: { id: row.id },
        data: { status: MembershipStatus.EXPIRED },
      });
    }
    return row;
  }

  async isActiveForUser(userId: string): Promise<boolean> {
    const m = await this.getForUser(userId);
    return !!m && m.status === MembershipStatus.ACTIVE && m.expiresAt.getTime() > Date.now();
  }

  /**
   * Returns the active membership "as of" a given date. Used by features
   * that need a stable answer for an event (e.g., extended-warranty
   * eligibility for a refund-window claim).
   */
  async wasActiveAt(userId: string, when: Date): Promise<boolean> {
    const row = await this.prisma.plusMembership.findUnique({ where: { userId } });
    if (!row) return false;
    return row.startedAt.getTime() <= when.getTime()
      && row.expiresAt.getTime() > when.getTime()
      && (row.status === MembershipStatus.ACTIVE || row.status === MembershipStatus.CANCELLED);
  }

  async start(userId: string, input: StartMembershipInput, actor: ActorMeta) {
    const existing = await this.getForUser(userId);
    if (existing && existing.status === MembershipStatus.ACTIVE && existing.expiresAt.getTime() > Date.now()) {
      throw new BadRequestException('Membership already active');
    }
    // Phase 23: require a default saved card. The card is what Stripe will
    // charge on every renewal, so we refuse to spin up a subscription
    // without one.
    const defaultMethod = await this.paymentMethods.defaultFor(userId);
    if (!defaultMethod) {
      throw new BadRequestException('Add a payment method before joining Plus');
    }

    const customerId = await this.paymentMethods.ensureCustomer(userId);
    // Make sure Stripe-side default is this card; safe to re-set.
    await this.stripe.setDefaultPaymentMethod(customerId, defaultMethod.providerMethodId);

    const priceId = this.priceIdFor(input.plan);
    const sub = await this.stripe.createSubscription({
      customerId,
      priceId,
      metadata: { onsective_user_id: userId, plan: input.plan },
    });
    const pricePaidMinor = this.priceFor(input.plan);
    const data = {
      plan: input.plan,
      status: MembershipStatus.ACTIVE,
      startedAt: new Date(),
      expiresAt: sub.currentPeriodEnd,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelledAt: null,
      cancelReason: null,
      renewedAt: existing ? new Date() : null,
      pricePaidMinor,
      currency: 'USD',
      paymentRef: sub.id,
      providerSubscriptionId: sub.id,
      autoRenew: true,
    };
    const row = existing
      ? await this.prisma.plusMembership.update({ where: { id: existing.id }, data })
      : await this.prisma.plusMembership.create({
          data: { id: newId(), userId, ...data },
        });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'membership.start',
      entityType: 'PlusMembership',
      entityId: row.id,
      after: { plan: input.plan, expiresAt: row.expiresAt, subscriptionId: sub.id },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return row;
  }

  async cancel(userId: string, reason: string | undefined, actor: ActorMeta) {
    const row = await this.prisma.plusMembership.findUnique({ where: { userId } });
    if (!row) throw new NotFoundException('No membership to cancel');
    if (row.status !== MembershipStatus.ACTIVE && row.status !== MembershipStatus.PAUSED) {
      throw new BadRequestException('Membership is not ACTIVE or PAUSED');
    }
    // Phase 23: cancel = "stop auto-renewing at period end". We do NOT flip
    // status here — Stripe will emit customer.subscription.deleted when
    // the period actually closes, and the webhook listener will mark
    // EXPIRED. Benefits stay live until then.
    if (row.providerSubscriptionId) {
      await this.stripe.setSubscriptionAutoRenew(row.providerSubscriptionId, false);
    }
    const updated = await this.prisma.plusMembership.update({
      where: { id: row.id },
      data: {
        autoRenew: false,
        cancelledAt: new Date(),
        cancelReason: reason ?? null,
        // Legacy Phase-22 rows with no subscription id don't get a webhook
        // ever — flip them straight to CANCELLED. Benefits keep expiring
        // by `expiresAt` via lazy expiry.
        status: row.providerSubscriptionId ? row.status : MembershipStatus.CANCELLED,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'membership.cancel',
      entityType: 'PlusMembership',
      entityId: row.id,
      before: row,
      after: updated,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  }

  /** Phase 23: re-enable auto-renew if the buyer changes their mind. */
  async setAutoRenew(userId: string, on: boolean, actor: ActorMeta) {
    const row = await this.prisma.plusMembership.findUnique({ where: { userId } });
    if (!row) throw new NotFoundException('No membership');
    if (!row.providerSubscriptionId) {
      throw new BadRequestException('This membership is not on a recurring subscription');
    }
    const sub = await this.stripe.setSubscriptionAutoRenew(row.providerSubscriptionId, on);
    const updated = await this.prisma.plusMembership.update({
      where: { id: row.id },
      data: {
        autoRenew: on,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelledAt: on ? null : row.cancelledAt ?? new Date(),
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: on ? 'membership.autorenew.on' : 'membership.autorenew.off',
      entityType: 'PlusMembership',
      entityId: row.id,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  }

  /** Webhook-side lookup. */
  getBySubscriptionId(subscriptionId: string) {
    return this.prisma.plusMembership.findUnique({
      where: { providerSubscriptionId: subscriptionId },
    });
  }

  /** Benefit values rendered to the buyer's account page. */
  benefits() {
    return {
      freeShipping: true,
      extendedWarrantyMonths: 3,
      earlyOutletAccess: true,
      pointsMultiplier: 1.5,
    };
  }
}
