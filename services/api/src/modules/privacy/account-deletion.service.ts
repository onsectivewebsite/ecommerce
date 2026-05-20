import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeletionRequestStatus,
  PaymentMethodStatus,
  ReferralCodeStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StripePaymentProvider } from '../payments/stripe.provider';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stripe: StripePaymentProvider,
    private readonly cfg: ConfigService,
  ) {}

  private graceDays(): number {
    return Number(this.cfg.get<string>('PRIVACY_DELETION_GRACE_DAYS') ?? '30');
  }

  async request(userId: string, reason: string | undefined, actor: ActorMeta) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.deletionStatus === DeletionRequestStatus.COMPLETED) {
      throw new BadRequestException('Account is already deleted');
    }
    if (user.deletionStatus === DeletionRequestStatus.REQUESTED) {
      // Idempotent — return current scheduled timestamp.
      return user;
    }

    const scheduledFor = new Date(Date.now() + this.graceDays() * DAY_MS);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: user.id },
        data: {
          deletionStatus: DeletionRequestStatus.REQUESTED,
          deletionRequestedAt: new Date(),
          deletionScheduledFor: scheduledFor,
        },
      });
      // Defense: revoke active refresh tokens now so a stale device can't
      // keep the session alive until the grace ends.
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return u;
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'account.deletion.request',
      entityType: 'User',
      entityId: user.id,
      after: { scheduledFor, reason: reason ?? null },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  }

  async cancel(userId: string, actor: ActorMeta) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.deletionStatus !== DeletionRequestStatus.REQUESTED) {
      throw new BadRequestException('No active deletion to cancel');
    }
    if (user.deletionScheduledFor && user.deletionScheduledFor.getTime() <= Date.now()) {
      throw new BadRequestException('Deletion grace period has ended');
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        deletionStatus: DeletionRequestStatus.CANCELLED,
        deletionRequestedAt: null,
        deletionScheduledFor: null,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'account.deletion.cancel',
      entityType: 'User',
      entityId: user.id,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  }

  /**
   * Returns rows that are due for anonymization right now. Used by the
   * scheduler. Public for admin oversight.
   */
  pendingDue() {
    return this.prisma.user.findMany({
      where: {
        deletionStatus: DeletionRequestStatus.REQUESTED,
        deletionScheduledFor: { lte: new Date() },
      },
      take: 50,
      orderBy: { deletionScheduledFor: 'asc' },
    });
  }

  pendingAll() {
    return this.prisma.user.findMany({
      where: { deletionStatus: DeletionRequestStatus.REQUESTED },
      orderBy: { deletionScheduledFor: 'asc' },
      take: 200,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        deletionRequestedAt: true, deletionScheduledFor: true,
      },
    });
  }

  /**
   * The actual scrub. Idempotent: if interrupted mid-flight, a re-run is
   * safe because every step is by-id and tolerates "nothing to do".
   */
  async anonymize(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { paymentMethods: true },
    });
    if (!user) return;
    if (user.deletionStatus !== DeletionRequestStatus.REQUESTED) return;

    // Step 1: detach payment methods on Stripe. Best-effort: log + continue
    // if Stripe rejects (e.g., already detached).
    for (const pm of user.paymentMethods) {
      if (pm.status === PaymentMethodStatus.DETACHED) continue;
      try {
        await this.stripe.detachPaymentMethod(pm.providerMethodId);
      } catch (e) {
        this.logger.warn(`stripe detach failed for ${pm.id}: ${(e as Error).message}`);
      }
    }

    // Step 2: scrub PII in a single transaction.
    const syntheticEmail = `deleted-${user.id.slice(0, 8)}@onsective.local`;
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentMethod.updateMany({
        where: { userId: user.id, status: PaymentMethodStatus.ACTIVE },
        data: { status: PaymentMethodStatus.DETACHED, isDefault: false },
      });
      await tx.pushDevice.deleteMany({ where: { userId: user.id } });
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.referralCode.updateMany({
        where: { userId: user.id, status: ReferralCodeStatus.ACTIVE },
        data: { status: ReferralCodeStatus.DISABLED },
      });
      await tx.address.updateMany({
        where: { userId: user.id },
        data: {
          fullName: '(redacted)',
          line1: '(redacted)',
          line2: null,
          phone: null,
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: {
          email: syntheticEmail,
          firstName: 'Deleted',
          lastName: 'User',
          passwordHash: '',
          phone: null,
          signupIp: null,
          referralCodeUsed: null,
          deletionStatus: DeletionRequestStatus.COMPLETED,
          deletedAt: new Date(),
          status: 'SUSPENDED',
        },
      });
    });

    await this.audit.record({
      actorUserId: user.id,
      action: 'account.deletion.complete',
      entityType: 'User',
      entityId: user.id,
      after: { email: syntheticEmail },
    });
  }
}
