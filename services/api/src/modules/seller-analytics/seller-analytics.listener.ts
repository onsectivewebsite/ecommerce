import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { SellerAnalyticsService } from './seller-analytics.service';

/**
 * Ingest VIEW / ADD_TO_CART / PURCHASE events from domain signals.
 *
 * VIEW events are emitted by the catalog detail endpoint (`product.viewed`).
 * ADD_TO_CART events come from `cart.item.added`. PURCHASE events fan out from
 * `order.placed` — one PURCHASE row per order item so per-SKU funnels work.
 *
 * All work is best-effort; failures are logged and never propagate.
 */
@Injectable()
export class SellerAnalyticsListener {
  private readonly logger = new Logger(SellerAnalyticsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: SellerAnalyticsService,
  ) {}

  @OnEvent('product.viewed')
  async onProductViewed(payload: { productId: string; userId?: string; sessionId?: string }) {
    const product = await this.prisma.product.findUnique({
      where: { id: payload.productId },
      select: { id: true, sellerId: true },
    });
    if (!product) return;
    await this.analytics.record({
      productId: product.id,
      sellerId: product.sellerId,
      kind: 'VIEW',
      userId: payload.userId,
      sessionId: payload.sessionId,
    });
  }

  @OnEvent('cart.item.added')
  async onCartItemAdded(payload: { variantId: string; qty: number; userId?: string; unitPriceMinor: number; currency: string }) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: payload.variantId },
      select: { id: true, productId: true, product: { select: { sellerId: true } } },
    });
    if (!variant) return;
    await this.analytics.record({
      productId: variant.productId,
      variantId: variant.id,
      sellerId: variant.product.sellerId,
      kind: 'ADD_TO_CART',
      userId: payload.userId,
      amountMinor: payload.unitPriceMinor * payload.qty,
      currency: payload.currency,
    });
  }

  @OnEvent('order.placed')
  async onOrderPlaced(payload: { orderId: string }) {
    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: { items: { include: { variant: { select: { productId: true } } } } },
    });
    if (!order) return;
    await Promise.all(order.items.map((i) =>
      this.analytics.record({
        productId: i.variant.productId,
        variantId: i.variantId,
        sellerId: order.sellerId,
        kind: 'PURCHASE',
        userId: order.userId,
        orderId: order.id,
        amountMinor: i.lineSubtotalMinor,
        currency: order.currency,
      }),
    ));
  }
}
