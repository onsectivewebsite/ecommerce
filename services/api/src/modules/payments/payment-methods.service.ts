import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, PaymentMethodStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import { StripePaymentProvider } from './stripe.provider';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger(PaymentMethodsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripePaymentProvider,
    private readonly audit: AuditService,
  ) {}

  // ---------------- customer linkage ----------------

  /**
   * Returns the Stripe customer id for this user, creating one if no
   * PaymentMethod row exists yet. The id is cached on every PaymentMethod
   * row of the same user — we look it up via `findFirst`. The first card
   * the user attaches stamps it; subsequent attaches reuse it.
   */
  async ensureCustomer(userId: string): Promise<string> {
    const existing = await this.prisma.paymentMethod.findFirst({
      where: { userId },
      select: { providerCustomerId: true },
    });
    if (existing) return existing.providerCustomerId;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return this.stripe.createCustomer({ email: user?.email, userId });
  }

  // ---------------- attach flow ----------------

  async createSetupIntent(userId: string): Promise<{ clientSecret: string }> {
    const customerId = await this.ensureCustomer(userId);
    const si = await this.stripe.createSetupIntent(customerId);
    return { clientSecret: si.clientSecret };
  }

  async attachConfirmed(userId: string, setupIntentId: string, actor: ActorMeta) {
    const resolved = await this.stripe.resolveSetupIntent(setupIntentId);
    // Refuse if the resolved customer doesn't match this user's customer id
    // (defense against a buyer pasting someone else's setup intent).
    const expectedCustomerId = await this.ensureCustomer(userId);
    if (resolved.customerId !== expectedCustomerId) {
      throw new ForbiddenException('SetupIntent does not belong to this user');
    }
    // Idempotent: if the same pm_id was already attached, return the row.
    const existing = await this.prisma.paymentMethod.findUnique({
      where: { providerMethodId: resolved.paymentMethodId },
    });
    if (existing) return existing;

    const isFirst = (await this.prisma.paymentMethod.count({
      where: { userId, status: PaymentMethodStatus.ACTIVE },
    })) === 0;

    const row = await this.prisma.paymentMethod.create({
      data: {
        id: newId(),
        userId,
        providerCustomerId: resolved.customerId,
        providerMethodId: resolved.paymentMethodId,
        brand: resolved.brand,
        last4: resolved.last4,
        expMonth: resolved.expMonth,
        expYear: resolved.expYear,
        isDefault: isFirst,
        status: PaymentMethodStatus.ACTIVE,
      },
    });
    if (isFirst) {
      // First card auto-promotes to default on Stripe side too so
      // subscriptions can renew against it.
      await this.stripe.setDefaultPaymentMethod(resolved.customerId, resolved.paymentMethodId);
    }
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'payment_method.attach',
      entityType: 'PaymentMethod',
      entityId: row.id,
      after: { brand: row.brand, last4: row.last4, isDefault: row.isDefault },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return row;
  }

  // ---------------- list / default / detach ----------------

  list(userId: string) {
    return this.prisma.paymentMethod.findMany({
      where: { userId, status: PaymentMethodStatus.ACTIVE },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async setDefault(userId: string, paymentMethodId: string, actor: ActorMeta) {
    const row = await this.prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } });
    if (!row || row.userId !== userId) throw new NotFoundException('Payment method not found');
    if (row.status !== PaymentMethodStatus.ACTIVE) {
      throw new BadRequestException('Payment method is not active');
    }
    if (row.isDefault) return row;
    await this.prisma.$transaction([
      this.prisma.paymentMethod.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.paymentMethod.update({
        where: { id: row.id },
        data: { isDefault: true },
      }),
    ]);
    await this.stripe.setDefaultPaymentMethod(row.providerCustomerId, row.providerMethodId);
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'payment_method.set_default',
      entityType: 'PaymentMethod',
      entityId: row.id,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.prisma.paymentMethod.findUniqueOrThrow({ where: { id: row.id } });
  }

  async detach(userId: string, paymentMethodId: string, actor: ActorMeta) {
    const row = await this.prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } });
    if (!row || row.userId !== userId) throw new NotFoundException('Payment method not found');
    if (row.status !== PaymentMethodStatus.ACTIVE) return row;

    // Refuse to detach the only ACTIVE method when an ACTIVE Plus
    // subscription depends on it — would brick the next renewal.
    const activeCount = await this.prisma.paymentMethod.count({
      where: { userId, status: PaymentMethodStatus.ACTIVE },
    });
    if (activeCount === 1) {
      const membership = await this.prisma.plusMembership.findUnique({
        where: { userId },
        select: { status: true, autoRenew: true, providerSubscriptionId: true },
      });
      if (
        membership &&
        membership.providerSubscriptionId &&
        membership.autoRenew &&
        (membership.status === MembershipStatus.ACTIVE || membership.status === MembershipStatus.PAUSED)
      ) {
        throw new BadRequestException(
          'Cannot remove your only card while Plus auto-renew is on. Cancel auto-renew or add another card first.',
        );
      }
    }

    await this.stripe.detachPaymentMethod(row.providerMethodId);
    const updated = await this.prisma.paymentMethod.update({
      where: { id: row.id },
      data: { status: PaymentMethodStatus.DETACHED, isDefault: false },
    });
    // If we just detached the default, promote the most recently-added
    // remaining card to default (both locally and on Stripe).
    if (row.isDefault) {
      const next = await this.prisma.paymentMethod.findFirst({
        where: { userId, status: PaymentMethodStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
      });
      if (next) {
        await this.prisma.paymentMethod.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
        await this.stripe.setDefaultPaymentMethod(next.providerCustomerId, next.providerMethodId);
      }
    }
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'payment_method.detach',
      entityType: 'PaymentMethod',
      entityId: row.id,
      before: row,
      after: updated,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  }

  /**
   * Read-side helper used by MembershipService: returns the user's default
   * ACTIVE payment method, or null.
   */
  defaultFor(userId: string) {
    return this.prisma.paymentMethod.findFirst({
      where: { userId, status: PaymentMethodStatus.ACTIVE, isDefault: true },
    });
  }
}
