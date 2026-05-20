import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationFeedService } from './notification-feed.service';

/**
 * Phase 27: writes inbox entries for the lifecycle events buyers care
 * about. We listen on the existing domain events so we don't have to
 * touch any of the source services. Every handler is best-effort and
 * tolerates the source row being deleted (returns silently).
 *
 * Idempotency is handled at the call site by leaning on the fact that
 * each source event only fires once for its corresponding transition.
 * Re-deliveries (which can happen for `order.paid` from webhook
 * retries) produce a second row — acceptable for a feed (the buyer
 * sees a stale entry rather than missing one) and not worth a unique
 * index on this hot path.
 */
@Injectable()
export class OrderEventsFeedListener {
  private readonly logger = new Logger(OrderEventsFeedListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feed: NotificationFeedService,
  ) {}

  @OnEvent('order.paid')
  async onPaid(payload: { orderId: string }) {
    if (!payload?.orderId) return;
    // Skip synthetic orders (subscription / ad top-up) — they have
    // ids prefixed with sub_ or ad_topup_.
    if (payload.orderId.startsWith('sub_') || payload.orderId.startsWith('ad_topup_')) return;
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.orderId },
        select: { id: true, userId: true, totalMinor: true, currency: true },
      });
      if (!order) return;
      await this.feed.write({
        userId: order.userId,
        kind: NotificationKind.ORDER_PAID,
        title: 'Order confirmed',
        body: `Your order is paid. We'll let you know when it ships.`,
        deepLinkPath: `/orders/${order.id}`,
        payload: { orderId: order.id, totalMinor: order.totalMinor, currency: order.currency },
      });
    } catch (e) {
      this.logger.warn(`order.paid feed write failed: ${(e as Error).message}`);
    }
  }

  /**
   * `shipment.updated` is the only event the shipping module emits.
   * We resolve to the order + status and emit a feed row when the
   * shipment first reaches a meaningful state.
   *
   * We rely on the shipping module's existing dedupe — it only writes
   * status forward, so the same status doesn't fire twice for one
   * shipment unless the row is rewound (which the platform doesn't do).
   */
  @OnEvent('shipment.updated')
  async onShipmentUpdated(payload: { shipmentId: string }) {
    if (!payload?.shipmentId) return;
    try {
      const shipment = await this.prisma.shipment.findUnique({
        where: { id: payload.shipmentId },
        select: {
          status: true,
          order: { select: { id: true, userId: true } },
        },
      });
      if (!shipment?.order) return;
      const { order, status } = shipment;
      if (status === 'PICKED_UP' || status === 'IN_TRANSIT') {
        await this.feed.write({
          userId: order.userId,
          kind: NotificationKind.ORDER_SHIPPED,
          title: 'Your order shipped',
          body: status === 'IN_TRANSIT'
            ? 'Your order is in transit.'
            : 'Your order has been picked up by the carrier.',
          deepLinkPath: `/orders/${order.id}`,
          payload: { orderId: order.id },
        });
      } else if (status === 'DELIVERED') {
        await this.feed.write({
          userId: order.userId,
          kind: NotificationKind.ORDER_DELIVERED,
          title: 'Delivered',
          body: 'Your order was delivered. Enjoy.',
          deepLinkPath: `/orders/${order.id}`,
          payload: { orderId: order.id },
        });
      }
    } catch (e) {
      this.logger.warn(`shipment.updated feed write failed: ${(e as Error).message}`);
    }
  }

  /**
   * Phase 27: when a seller, admin, or system message lands in a thread,
   * write an inbox entry for the buyer. The reverse direction (buyer →
   * seller) is out of scope here — the seller portal has its own
   * separate inbox surface from Phase 9.
   */
  @OnEvent('message.new')
  async onMessageNew(payload: {
    threadId: string;
    messageId: string;
    senderKind: 'BUYER' | 'SELLER' | 'ADMIN' | 'SYSTEM';
    buyerUserId: string;
    sellerId: string;
  }) {
    if (!payload?.threadId || payload.senderKind === 'BUYER') return;
    try {
      await this.feed.write({
        userId: payload.buyerUserId,
        kind: NotificationKind.MESSAGE_NEW,
        title: 'New message',
        body:
          payload.senderKind === 'SYSTEM'
            ? 'You have a new system message.'
            : 'You have a new message from the seller.',
        deepLinkPath: `/account/messages/${payload.threadId}`,
        payload: { threadId: payload.threadId, messageId: payload.messageId },
      });
    } catch (e) {
      this.logger.warn(`message.new feed write failed: ${(e as Error).message}`);
    }
  }
}
