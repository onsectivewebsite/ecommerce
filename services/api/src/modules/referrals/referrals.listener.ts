import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferralsService } from './referrals.service';

/**
 * Phase 25: on every order.paid, check whether the buyer has a captured
 * referral code and is on their first paid order. The service handles the
 * "is first paid order" check internally and short-circuits otherwise.
 *
 * Errors log and don't propagate — referral payout must never affect the
 * primary order flow.
 */
@Injectable()
export class ReferralPayoutListener {
  private readonly logger = new Logger(ReferralPayoutListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly referrals: ReferralsService,
  ) {}

  @OnEvent('order.paid')
  async onOrderPaid(payload: { orderId: string }) {
    if (!payload?.orderId) return;
    // Skip synthetic orders used for sub/ad top-ups.
    if (payload.orderId.startsWith('sub_') || payload.orderId.startsWith('ad_topup_')) return;
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.orderId },
        select: { userId: true },
      });
      if (!order) return;
      await this.referrals.processFirstPaidOrder({
        inviteeUserId: order.userId,
        orderId: payload.orderId,
      });
    } catch (e) {
      this.logger.warn(`referral payout failed: ${(e as Error).message}`);
    }
  }
}
