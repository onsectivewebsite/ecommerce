import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletService } from '../wallet/wallet.service';
import type { AbandonedCartNudgeStage } from '@prisma/client';

const HOURS = 60 * 60 * 1000;
const STAGE1_MIN_HOURS = 24;
const STAGE2_MIN_HOURS = 72;
const STAGE2_INCENTIVE_MINOR = 500; // $5 USD wallet credit on the 72h nudge

/**
 * Abandoned-cart recovery.
 *
 * Logic: a cart is "abandoned" if it has items, the buyer's user.id is set,
 * `updatedAt` was more than N hours ago, the buyer has not placed an order
 * since `updatedAt`, and the cart isn't suppressed. We send at most two
 * pushes per cart, tracked in `AbandonedCartNudge` for idempotency.
 *
 * The second-touch nudge optionally drops a small wallet credit on the buyer
 * as a real conversion incentive (env-gated for safety).
 */
@Injectable()
export class AbandonedCartService {
  private readonly logger = new Logger(AbandonedCartService.name);
  private readonly enableIncentive = process.env.CART_RECOVERY_INCENTIVE === '1';

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly wallet: WalletService,
    private readonly events: EventEmitter2,
  ) {}

  async runOnce(): Promise<{ scanned: number; stage1: number; stage2: number }> {
    const now = Date.now();
    const stage1Cutoff = new Date(now - STAGE1_MIN_HOURS * HOURS);
    const stage2Cutoff = new Date(now - STAGE2_MIN_HOURS * HOURS);
    const lookbackFloor = new Date(now - 7 * 24 * HOURS); // don't nudge anything older than a week

    const candidates = await this.prisma.cart.findMany({
      where: {
        userId: { not: null },
        recoverySuppressedAt: null,
        updatedAt: { lt: stage1Cutoff, gt: lookbackFloor },
        items: { some: {} },
      },
      include: {
        items: { include: { variant: { select: { product: { select: { title: true } } } } } },
        user: { select: { id: true, firstName: true } },
        nudges: true,
      },
      take: 1000,
    });

    let s1 = 0, s2 = 0;
    for (const cart of candidates) {
      if (!cart.user) continue;
      // Skip if buyer placed an order after the cart was last updated.
      const recentOrder = await this.prisma.order.findFirst({
        where: { userId: cart.user.id, createdAt: { gt: cart.updatedAt } },
        select: { id: true },
      });
      if (recentOrder) {
        // Buyer converted — mark suppressed so we never look at this cart again.
        await this.prisma.cart.update({
          where: { id: cart.id }, data: { recoverySuppressedAt: new Date() },
        });
        continue;
      }
      const sent: Set<AbandonedCartNudgeStage> = new Set(cart.nudges.map((n) => n.stage));
      const eligibleStage2 = cart.updatedAt < stage2Cutoff;

      if (eligibleStage2 && !sent.has('SECOND_72H')) {
        if (await this.send(cart, 'SECOND_72H')) s2++;
      } else if (!sent.has('FIRST_24H')) {
        if (await this.send(cart, 'FIRST_24H')) s1++;
      }
    }

    return { scanned: candidates.length, stage1: s1, stage2: s2 };
  }

  private async send(
    cart: { id: string; user: { id: string; firstName: string } | null; items: any[] },
    stage: AbandonedCartNudgeStage,
  ): Promise<boolean> {
    if (!cart.user) return false;
    const first = cart.items[0]?.variant?.product?.title ?? 'your selection';
    const moreCount = Math.max(0, cart.items.length - 1);
    const tail = moreCount > 0 ? ` and ${moreCount} more` : '';

    let body = `${cart.user.firstName}, you left "${first.slice(0, 60)}"${tail} in your cart.`;
    let title = stage === 'FIRST_24H' ? 'Forget something?' : 'Still thinking it over?';

    if (stage === 'SECOND_72H' && this.enableIncentive) {
      try {
        await this.wallet.applyDelta({
          userId: cart.user.id,
          amountMinor: STAGE2_INCENTIVE_MINOR,
          kind: 'CREDIT_PROMO',
          reason: `Cart recovery credit for cart ${cart.id}`,
        });
        body += ` We added $${(STAGE2_INCENTIVE_MINOR / 100).toFixed(2)} to your wallet — apply it at checkout.`;
      } catch (e) {
        this.logger.warn(`recovery incentive credit failed: ${(e as Error).message}`);
      }
    }

    try {
      await this.notifications.sendToUser(cart.user.id, {
        title, body,
        data: { screen: 'Cart' },
        categoryId: stage === 'FIRST_24H' ? 'cart_recovery_24h' : 'cart_recovery_72h',
      });
      // Phase 11: also fire an event so the email listener can send the
      // matching email version (per-category opt-out is checked downstream).
      this.events.emit('cart.recovery.queued', {
        cartId: cart.id, userId: cart.user.id, stage,
        incentive: stage === 'SECOND_72H' && this.enableIncentive
          ? `We added $${(STAGE2_INCENTIVE_MINOR / 100).toFixed(2)} to your wallet — apply it at checkout.`
          : '',
      });
      await this.prisma.abandonedCartNudge.create({
        data: { id: newId(), cartId: cart.id, stage },
      });
      return true;
    } catch (e) {
      this.logger.warn(`recovery push failed for cart ${cart.id}: ${(e as Error).message}`);
      return false;
    }
  }

  /** Called from CartService when the buyer clears the cart or checks out. */
  async suppress(cartId: string) {
    await this.prisma.cart.update({
      where: { id: cartId }, data: { recoverySuppressedAt: new Date() },
    }).catch(() => undefined);
  }
}
