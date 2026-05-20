import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ProductCondition, SustainabilitySubjectKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SustainabilityService } from './sustainability.service';

/**
 * Sustainability is a derived read-model. We subscribe to the primary
 * lifecycle events and write impact rows in the background. If our write
 * fails, the source lifecycle is unaffected — we only log and move on.
 */
@Injectable()
export class SustainabilityListener {
  private readonly logger = new Logger(SustainabilityListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sustain: SustainabilityService,
  ) {}

  /**
   * order.paid is emitted by the payments listener once an order captures.
   * Skip subscription/ads top-up "orders" (they have synthetic ids), and
   * skip any line that isn't a REFURB_GRADE_* or OPEN_BOX product.
   */
  @OnEvent('order.paid')
  async onOrderPaid(payload: { orderId: string }) {
    if (!payload?.orderId) return;
    if (payload.orderId.startsWith('sub_') || payload.orderId.startsWith('ad_topup_')) return;

    try {
      const items = await this.prisma.orderItem.findMany({
        where: { orderId: payload.orderId },
        include: {
          variant: {
            include: {
              product: {
                select: {
                  condition: true, brandId: true,
                  category: { select: { slug: true } },
                },
              },
            },
          },
          order: { select: { userId: true, sellerId: true } },
        },
      });
      for (const item of items) {
        const c = item.variant.product.condition;
        const kind = mapPurchaseKind(c);
        if (!kind) continue;
        await this.sustain.record({
          subjectKind: kind,
          subjectId: item.id,
          buyerUserId: item.order.userId,
          sellerId: item.order.sellerId,
          brandId: item.variant.product.brandId,
          categorySlug: item.variant.product.category.slug,
          scale: item.qty,
          reason: `Purchase of ${c} order item`,
        });
      }
    } catch (e) {
      this.logger.warn(`order.paid impact write failed: ${(e as Error).message}`);
    }
  }

  /** Phase 15 trade-in paid out. */
  @OnEvent('tradein.order.paid')
  async onTradeInPaid(payload: { orderId: string }) {
    if (!payload?.orderId) return;
    try {
      const order = await this.prisma.tradeInOrder.findUnique({
        where: { id: payload.orderId },
        include: {
          model: {
            include: {
              sourceProduct: {
                select: { brandId: true, category: { select: { slug: true } } },
              },
            },
          },
        },
      });
      if (!order) return;
      await this.sustain.record({
        subjectKind: SustainabilitySubjectKind.TRADEIN_PAYOUT,
        subjectId: order.id,
        buyerUserId: order.buyerUserId,
        brandId: order.model.sourceProduct.brandId,
        categorySlug: order.model.sourceProduct.category.slug,
        reason: `Trade-in payout (grade ${order.actualGrade ?? order.declaredGrade})`,
      });
    } catch (e) {
      this.logger.warn(`tradein.order.paid impact write failed: ${(e as Error).message}`);
    }
  }

  /** Phase 19 repair completed extends an existing unit's life. */
  @OnEvent('repair.ticket.completed')
  async onRepairCompleted(payload: { ticketId: string; warrantyClaimId: string }) {
    if (!payload?.warrantyClaimId) return;
    try {
      const claim = await this.prisma.warrantyClaim.findUnique({
        where: { id: payload.warrantyClaimId },
        include: {
          orderItem: {
            include: {
              variant: {
                include: {
                  product: {
                    select: { brandId: true, category: { select: { slug: true } } },
                  },
                },
              },
              order: { select: { userId: true, sellerId: true } },
            },
          },
        },
      });
      if (!claim) return;
      await this.sustain.record({
        subjectKind: SustainabilitySubjectKind.REPAIR_COMPLETED,
        subjectId: payload.ticketId,
        buyerUserId: claim.orderItem.order.userId,
        sellerId: claim.orderItem.order.sellerId,
        brandId: claim.orderItem.variant.product.brandId,
        categorySlug: claim.orderItem.variant.product.category.slug,
        reason: `Repair completed for warranty claim ${claim.id}`,
      });
    } catch (e) {
      this.logger.warn(`repair.ticket.completed impact write failed: ${(e as Error).message}`);
    }
  }
}

function mapPurchaseKind(c: ProductCondition): SustainabilitySubjectKind | null {
  switch (c) {
    case ProductCondition.REFURB_GRADE_A:
    case ProductCondition.REFURB_GRADE_B:
    case ProductCondition.REFURB_GRADE_C:
      return SustainabilitySubjectKind.REFURB_PURCHASE;
    case ProductCondition.OPEN_BOX:
      return SustainabilitySubjectKind.OPENBOX_PURCHASE;
    default:
      return null;
  }
}
