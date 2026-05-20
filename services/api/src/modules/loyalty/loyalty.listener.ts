import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ProductCondition } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService } from './points.service';

/**
 * Points earning is a derived side-effect of primary lifecycle events
 * (purchase paid, trade-in paid out, repair completed). If a write fails
 * we log and move on — the primary flow already succeeded, and
 * referenceKey idempotency lets us retry safely later.
 */
@Injectable()
export class LoyaltyListener {
  private readonly logger = new Logger(LoyaltyListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
  ) {}

  @OnEvent('order.paid')
  async onOrderPaid(payload: { orderId: string }) {
    if (!payload?.orderId) return;
    // Skip synthetic "orders" used for subscription / ad top-ups.
    if (payload.orderId.startsWith('sub_') || payload.orderId.startsWith('ad_topup_')) return;

    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.orderId },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: { select: { condition: true } },
                },
              },
            },
          },
        },
      });
      if (!order) return;

      const subtotalMinor = order.items.reduce(
        (s, i) => s + i.unitPriceMinor * i.qty,
        0,
      );
      const refurbOpenboxSubtotalMinor = order.items
        .filter((i) => isRefurbOrOpenbox(i.variant.product.condition))
        .reduce((s, i) => s + i.unitPriceMinor * i.qty, 0);

      await this.points.awardForOrder({
        userId: order.userId,
        orderId: order.id,
        subtotalMinor,
        refurbAndOpenboxSubtotalMinor: refurbOpenboxSubtotalMinor,
      });
    } catch (e) {
      this.logger.warn(`order.paid loyalty award failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('tradein.order.paid')
  async onTradeInPaid(payload: { orderId: string }) {
    if (!payload?.orderId) return;
    try {
      const order = await this.prisma.tradeInOrder.findUnique({
        where: { id: payload.orderId },
        select: { id: true, buyerUserId: true },
      });
      if (!order) return;
      await this.points.awardForTradeIn(order.buyerUserId, order.id);
    } catch (e) {
      this.logger.warn(`tradein.order.paid loyalty award failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('repair.ticket.completed')
  async onRepairCompleted(payload: { ticketId: string; warrantyClaimId: string }) {
    if (!payload?.warrantyClaimId) return;
    try {
      const claim = await this.prisma.warrantyClaim.findUnique({
        where: { id: payload.warrantyClaimId },
        include: { orderItem: { select: { order: { select: { userId: true } } } } },
      });
      if (!claim) return;
      await this.points.awardForRepair(claim.orderItem.order.userId, payload.ticketId);
    } catch (e) {
      this.logger.warn(`repair.ticket.completed loyalty award failed: ${(e as Error).message}`);
    }
  }
}

function isRefurbOrOpenbox(c: ProductCondition): boolean {
  return (
    c === ProductCondition.REFURB_GRADE_A ||
    c === ProductCondition.REFURB_GRADE_B ||
    c === ProductCondition.REFURB_GRADE_C ||
    c === ProductCondition.OPEN_BOX
  );
}
