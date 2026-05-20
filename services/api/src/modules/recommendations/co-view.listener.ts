import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';

/**
 * On every `order.paid` we record co-purchase pairs for the FBT recommender.
 * Pairs are canonicalized (aId < bId) so we never double-count a pair.
 * Increments are upserts — safe to run twice for the same order.
 */
@Injectable()
export class CoViewListener {
  private readonly logger = new Logger(CoViewListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('order.paid')
  async onPaid(payload: { orderId: string }) {
    if (!payload.orderId || payload.orderId.startsWith('sub_') || payload.orderId.startsWith('ad_topup_')) return;
    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: { items: { include: { variant: { select: { productId: true } } } } },
    });
    if (!order) return;
    const productIds = Array.from(new Set(order.items.map((i) => i.variant.productId)));
    if (productIds.length < 2) return;
    const now = new Date();
    for (let i = 0; i < productIds.length; i++) {
      for (let j = i + 1; j < productIds.length; j++) {
        const [aId, bId] = productIds[i] < productIds[j]
          ? [productIds[i], productIds[j]]
          : [productIds[j], productIds[i]];
        try {
          await this.prisma.productCoView.upsert({
            where: { aId_bId: { aId, bId } },
            create: { id: newId(), aId, bId, count: 1, lastAt: now },
            update: { count: { increment: 1 }, lastAt: now },
          });
        } catch (e) {
          this.logger.warn(`coview upsert failed (${aId},${bId}): ${(e as Error).message}`);
        }
      }
    }
  }
}
