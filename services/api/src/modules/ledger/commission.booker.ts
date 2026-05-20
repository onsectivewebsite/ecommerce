import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from './ledger.service';

/**
 * Listens to order lifecycle events and posts balanced ledger entries.
 * Idempotency comes from LedgerService.post (txnId derived from order.id).
 */
@Injectable()
export class CommissionBooker {
  private readonly logger = new Logger(CommissionBooker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  @OnEvent('order.paid')
  async onPaid(payload: { orderId: string }) {
    if (!payload.orderId || payload.orderId.startsWith('sub_')) return;
    const order = await this.prisma.order.findUnique({ where: { id: payload.orderId } });
    if (!order) return;
    try {
      await this.ledger.bookOrderPaid({
        orderId: order.id,
        sellerId: order.sellerId,
        grossMinor: order.subtotalMinor + order.shippingMinor + order.taxMinor,
        commissionMinor: order.commissionMinor,
        currency: order.currency,
      });
    } catch (e) {
      this.logger.error(`Ledger post failed for order ${order.id}: ${(e as Error).message}`);
    }
  }

  @OnEvent('order.refunded')
  async onRefunded(payload: { orderId: string }) {
    const order = await this.prisma.order.findUnique({ where: { id: payload.orderId } });
    if (!order) return;
    try {
      await this.ledger.bookOrderRefunded({
        orderId: order.id,
        sellerId: order.sellerId,
        grossMinor: order.subtotalMinor + order.shippingMinor + order.taxMinor,
        commissionMinor: order.commissionMinor,
        currency: order.currency,
      });
    } catch (e) {
      this.logger.error(`Ledger refund post failed for order ${order.id}: ${(e as Error).message}`);
    }
  }
}
