import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryStockService } from './inventory-stock.service';

/**
 * On order.paid, debit per-warehouse stock for every PLATFORM-fulfilled line
 * (identified by `fulfilledFromWarehouseId`). This is the OF counterpart to
 * the legacy ProductVariant.inventoryQty decrement that runs inside the
 * order $transaction.
 *
 * Idempotency: we set `OrderItem.pickedAt` once we've debited; re-runs of
 * the same event skip already-debited lines so a re-emitted `order.paid`
 * (e.g., from RiskService.release) doesn't double-debit.
 */
@Injectable()
export class FulfillmentListener {
  private readonly logger = new Logger(FulfillmentListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: InventoryStockService,
  ) {}

  @OnEvent('order.paid')
  async onOrderPaid(payload: { orderId: string }) {
    if (!payload.orderId || payload.orderId.startsWith('sub_') || payload.orderId.startsWith('ad_topup_')) return;
    const items = await this.prisma.orderItem.findMany({
      where: { orderId: payload.orderId, fulfilledFromWarehouseId: { not: null }, pickedAt: null },
    });
    for (const item of items) {
      try {
        await this.stock.consumeForFulfillment(item.variantId, item.fulfilledFromWarehouseId!, item.qty);
        await this.prisma.orderItem.update({
          where: { id: item.id }, data: { pickedAt: new Date() },
        });
      } catch (e) {
        // Stock came up short (someone shipped manually, oversold). Log and
        // surface to ops via the existing risk/health channels.
        this.logger.error(`OF stock debit failed for item ${item.id}: ${(e as Error).message}`);
      }
    }
  }
}
