import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationKind,
  PointsTransactionKind,
  ReferralCodeStatus,
  ReferralRedemptionRejectionReason,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { PointsService } from '../loyalty/points.service';
import { NotificationFeedService } from '../notification-feed/notification-feed.service';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;
const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT_PER_30D = 25;

function generateCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
    private readonly cfg: ConfigService,
    private readonly feed: NotificationFeedService,
  ) {}

  private inviterPoints(): number {
    return Number(this.cfg.get<string>('LOYALTY_REFERRAL_INVITER_POINTS') ?? '500');
  }
  private inviteePoints(): number {
    return Number(this.cfg.get<string>('LOYALTY_REFERRAL_INVITEE_POINTS') ?? '500');
  }
  private limitPer30d(): number {
    return Number(this.cfg.get<string>('LOYALTY_REFERRAL_LIMIT_30D') ?? String(DEFAULT_LIMIT_PER_30D));
  }

  // ---------------- code lifecycle ----------------

  async getOrCreateForUser(userId: string) {
    const existing = await this.prisma.referralCode.findUnique({ where: { userId } });
    if (existing) return existing;
    // Tight retry loop on collision — at 31^8 the chance of a collision is
    // negligible but defensive code is cheap.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      try {
        return await this.prisma.referralCode.create({
          data: {
            id: newId(),
            code,
            userId,
            status: ReferralCodeStatus.ACTIVE,
          },
        });
      } catch (e) {
        if ((e as { code?: string })?.code === 'P2002') continue;
        throw e;
      }
    }
    throw new Error('Failed to generate a unique referral code');
  }

  async getByCode(code: string) {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return null;
    const row = await this.prisma.referralCode.findUnique({
      where: { code: normalized },
      include: { user: { select: { id: true, signupIp: true } } },
    });
    return row;
  }

  // ---------------- payout ----------------

  /**
   * Called by the order.paid listener for every paid order. The service
   * itself decides whether this is the invitee's first paid order (and
   * therefore whether to attempt a payout). Anti-fraud rejections write a
   * ReferralAbuseEvent row and silently no-op the payout — the order is
   * unaffected.
   */
  async processFirstPaidOrder(input: {
    inviteeUserId: string;
    orderId: string;
  }): Promise<{ processed: boolean; reason?: ReferralRedemptionRejectionReason }> {
    // Has this invitee already redeemed once? (covers double-process cases)
    const existing = await this.prisma.referralRedemption.findUnique({
      where: { inviteeUserId: input.inviteeUserId },
    });
    if (existing) return { processed: false, reason: ReferralRedemptionRejectionReason.ALREADY_REDEEMED };

    // Is this actually the invitee's first paid order? If they already had
    // one, the captured code is "spent" and we ignore later orders.
    const earlierPaid = await this.prisma.order.findFirst({
      where: {
        userId: input.inviteeUserId,
        status: 'PAID',
        id: { not: input.orderId },
      },
      select: { id: true },
    });
    if (earlierPaid) return { processed: false };

    const invitee = await this.prisma.user.findUnique({
      where: { id: input.inviteeUserId },
      include: {
        addresses: {
          where: { isDefault: true },
          select: { line1: true, postalCode: true },
          take: 1,
        },
      },
    });
    if (!invitee?.referralCodeUsed) return { processed: false };

    const code = await this.getByCode(invitee.referralCodeUsed);
    if (!code) {
      await this.logAbuse({
        attemptedCode: invitee.referralCodeUsed,
        attemptedUserId: input.inviteeUserId,
        reason: ReferralRedemptionRejectionReason.NO_SUCH_CODE,
        ip: invitee.signupIp,
      });
      return { processed: false, reason: ReferralRedemptionRejectionReason.NO_SUCH_CODE };
    }
    if (code.status !== ReferralCodeStatus.ACTIVE) {
      await this.logAbuse({
        attemptedCode: code.code,
        attemptedUserId: input.inviteeUserId,
        reason: ReferralRedemptionRejectionReason.CODE_DISABLED,
        ip: invitee.signupIp,
      });
      return { processed: false, reason: ReferralRedemptionRejectionReason.CODE_DISABLED };
    }

    // Self-redemption.
    if (code.userId === input.inviteeUserId) {
      await this.logAbuse({
        attemptedCode: code.code,
        attemptedUserId: input.inviteeUserId,
        reason: ReferralRedemptionRejectionReason.SELF_REDEMPTION,
        ip: invitee.signupIp,
      });
      return { processed: false, reason: ReferralRedemptionRejectionReason.SELF_REDEMPTION };
    }

    // Same signup IP (inviter signup vs invitee signup).
    const inviter = await this.prisma.user.findUnique({
      where: { id: code.userId },
      include: {
        addresses: {
          where: { isDefault: true },
          select: { line1: true, postalCode: true },
          take: 1,
        },
      },
    });
    if (
      inviter &&
      invitee.signupIp &&
      inviter.signupIp &&
      inviter.signupIp === invitee.signupIp
    ) {
      await this.logAbuse({
        attemptedCode: code.code,
        attemptedUserId: input.inviteeUserId,
        reason: ReferralRedemptionRejectionReason.SAME_IP,
        ip: invitee.signupIp,
      });
      return { processed: false, reason: ReferralRedemptionRejectionReason.SAME_IP };
    }

    // Same default shipping address (line1 + postal).
    const inviterAddr = inviter?.addresses[0];
    const inviteeAddr = invitee.addresses[0];
    if (
      inviterAddr &&
      inviteeAddr &&
      inviterAddr.line1.trim().toLowerCase() === inviteeAddr.line1.trim().toLowerCase() &&
      inviterAddr.postalCode.trim() === inviteeAddr.postalCode.trim()
    ) {
      await this.logAbuse({
        attemptedCode: code.code,
        attemptedUserId: input.inviteeUserId,
        reason: ReferralRedemptionRejectionReason.SAME_ADDRESS,
        ip: invitee.signupIp,
      });
      return { processed: false, reason: ReferralRedemptionRejectionReason.SAME_ADDRESS };
    }

    // Rolling 30d cap on redemptions per inviter.
    const since = new Date(Date.now() - ROLLING_WINDOW_MS);
    const recent = await this.prisma.referralRedemption.count({
      where: { inviterUserId: code.userId, createdAt: { gt: since } },
    });
    if (recent >= this.limitPer30d()) {
      await this.logAbuse({
        attemptedCode: code.code,
        attemptedUserId: input.inviteeUserId,
        reason: ReferralRedemptionRejectionReason.LIMIT_REACHED,
        ip: invitee.signupIp,
      });
      return { processed: false, reason: ReferralRedemptionRejectionReason.LIMIT_REACHED };
    }

    // Award both sides + write the redemption row. The redemption row's
    // unique constraints (inviteeUserId, inviteeFirstOrderId) protect
    // against double-processing under webhook re-delivery.
    const inviterAmount = this.inviterPoints();
    const inviteeAmount = this.inviteePoints();
    try {
      await this.prisma.referralRedemption.create({
        data: {
          id: newId(),
          codeId: code.id,
          inviterUserId: code.userId,
          inviteeUserId: input.inviteeUserId,
          inviteeFirstOrderId: input.orderId,
          inviterPointsAwarded: inviterAmount,
          inviteePointsAwarded: inviteeAmount,
          signupIp: invitee.signupIp ?? null,
        },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') return { processed: false };
      throw e;
    }
    await this.prisma.referralCode.update({
      where: { id: code.id },
      data: { totalRedemptions: { increment: 1 } },
    });
    // PointsService.applyDelta is idempotent via referenceKey, so re-runs
    // here can't double-award even if the redemption row was somehow
    // created and the award step crashed.
    await this.points.applyDelta({
      userId: code.userId,
      amount: inviterAmount,
      kind: PointsTransactionKind.EARN_BONUS,
      reason: `Referral: friend joined`,
      referenceKey: `referral_inviter:${input.inviteeUserId}`,
    });
    await this.points.applyDelta({
      userId: input.inviteeUserId,
      amount: inviteeAmount,
      kind: PointsTransactionKind.EARN_BONUS,
      reason: `Referral signup bonus`,
      referenceKey: `referral_invitee:${input.inviteeUserId}`,
    });
    // Phase 27: notify both sides in their in-app inbox.
    const inviteeUser = await this.prisma.user.findUnique({
      where: { id: input.inviteeUserId },
      select: { firstName: true, lastName: true },
    });
    const inviteeDisplay = inviteeUser
      ? `${inviteeUser.firstName}${inviteeUser.lastName ? ' ' + inviteeUser.lastName.charAt(0) + '.' : ''}`
      : 'A friend';
    await this.feed.write({
      userId: code.userId,
      kind: NotificationKind.REFERRAL_REDEEMED,
      title: `${inviteeDisplay} just joined`,
      body: `You earned ${inviterAmount} bonus points from your referral.`,
      deepLinkPath: '/account/referrals',
    });
    await this.feed.write({
      userId: input.inviteeUserId,
      kind: NotificationKind.REFERRAL_REDEEMED,
      title: 'Welcome bonus credited',
      body: `You earned ${inviteeAmount} bonus points from joining via referral.`,
      deepLinkPath: '/account/points',
    });
    return { processed: true };
  }

  // ---------------- reads for buyer page ----------------

  async myRedemptions(userId: string) {
    const rows = await this.prisma.referralRedemption.findMany({
      where: { inviterUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        invitee: { select: { firstName: true, lastName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      inviteeFirstName: r.invitee.firstName,
      inviteeInitial: r.invitee.lastName ? r.invitee.lastName.charAt(0) : '',
      pointsAwarded: r.inviterPointsAwarded,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async myStats(userId: string) {
    const code = await this.getOrCreateForUser(userId);
    return {
      code: code.code,
      status: code.status,
      totalRedemptions: code.totalRedemptions,
      inviterRewardPoints: this.inviterPoints(),
      inviteeRewardPoints: this.inviteePoints(),
    };
  }

  // ---------------- admin ----------------

  async disable(code: string, adminUserId: string) {
    const row = await this.prisma.referralCode.findUnique({ where: { code: code.toUpperCase() } });
    if (!row) throw new NotFoundException('Code not found');
    return this.prisma.referralCode.update({
      where: { id: row.id },
      data: { status: ReferralCodeStatus.DISABLED, updatedAt: new Date() },
    });
  }

  async recentAbuseEvents(limit = 100) {
    return this.prisma.referralAbuseEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, limit)),
    });
  }

  async topInviters(days = 30, limit = 20) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const grouped = await this.prisma.referralRedemption.groupBy({
      by: ['inviterUserId'],
      where: { createdAt: { gt: since } },
      _count: { _all: true },
      orderBy: { _count: { inviterUserId: 'desc' } },
      take: limit,
    });
    if (grouped.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.inviterUserId) } },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return grouped.map((g) => {
      const u = byId.get(g.inviterUserId);
      return {
        userId: g.inviterUserId,
        email: u?.email ?? '',
        name: u ? `${u.firstName} ${u.lastName}`.trim() : '',
        redemptions: g._count._all,
      };
    });
  }

  // ---------------- helpers ----------------

  private async logAbuse(input: {
    attemptedCode: string;
    attemptedUserId?: string | null;
    reason: ReferralRedemptionRejectionReason;
    ip?: string | null;
    userAgent?: string | null;
  }) {
    try {
      await this.prisma.referralAbuseEvent.create({
        data: {
          id: newId(),
          attemptedCode: input.attemptedCode,
          attemptedUserId: input.attemptedUserId ?? null,
          reason: input.reason,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`referral abuse log failed: ${(e as Error).message}`);
    }
  }
}
