import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Bridge from internal domain events to push notifications. Each handler
 * is best-effort: failures are logged, never thrown, so the originating
 * transaction stays committed even if pushes hit a transient outage.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent('order.paid')
  async onOrderPaid(payload: { orderId: string }) {
    if (!payload.orderId || payload.orderId.startsWith('sub_') || payload.orderId.startsWith('ad_topup_')) return;
    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      select: { id: true, userId: true, totalMinor: true, currency: true },
    });
    if (!order) return;
    await this.notifications.sendToUser(order.userId, {
      title: 'Payment received',
      body: `Thanks! Your order #${order.id.slice(-6)} for ${formatMoney(order.totalMinor, order.currency)} is confirmed.`,
      data: { screen: 'Order', orderId: order.id },
      categoryId: 'order_paid',
    }).catch((e) => this.logger.warn(`order.paid push failed: ${(e as Error).message}`));
  }

  // Shipping emits `shipment.updated` with `{ shipmentId }` (no per-event payload).
  // We read the latest ShipmentEvent and push once per qualifying milestone.
  @OnEvent('shipment.updated')
  async onShipmentUpdated(payload: { shipmentId: string }) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: payload.shipmentId },
      include: {
        order: { select: { id: true, userId: true } },
        events: { orderBy: { occurredAt: 'desc' }, take: 1 },
      },
    });
    if (!shipment || shipment.events.length === 0) return;
    const latest = shipment.events[0];
    const code = latest.code;
    let title = '';
    if (code === 'picked_up')             title = 'Your order is on the way';
    else if (code === 'in_transit')       title = 'In transit';
    else if (code === 'out_for_delivery') title = 'Out for delivery';
    else if (code === 'delivered')        title = 'Delivered';
    else if (code === 'exception')        title = 'Delivery exception';
    else return; // unknown code → no push (label_created, cancelled, etc.)
    await this.notifications.sendToUser(shipment.order.userId, {
      title,
      body: latest.label,
      data: { screen: 'Order', orderId: shipment.order.id, shipmentId: shipment.id },
      categoryId: `shipment_${code}`,
    }).catch((e) => this.logger.warn(`shipment.updated push failed: ${(e as Error).message}`));
  }

  @OnEvent('payout.paid')
  async onPayoutPaid(payload: { payoutId: string }) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payload.payoutId },
      include: { seller: { select: { userId: true } } },
    });
    if (!payout) return;
    await this.notifications.sendToUser(payout.seller.userId, {
      title: 'Payout sent',
      body: `Your payout of ${formatMoney(payout.amountMinor, payout.currency)} has been sent.`,
      data: { screen: 'Payouts', payoutId: payout.id },
      categoryId: 'payout_paid',
    }).catch((e) => this.logger.warn(`payout.paid push failed: ${(e as Error).message}`));
  }

  // ---------- Phase 9: returns / reviews / disputes ----------

  @OnEvent('return.requested')
  async onReturnRequested(payload: { returnId: string }) {
    const r = await this.prisma.return.findUnique({
      where: { id: payload.returnId },
      include: { seller: { select: { userId: true } }, order: { select: { id: true } } },
    });
    if (!r) return;
    await this.notifications.sendToUser(r.seller.userId, {
      title: 'New return request',
      body: `Buyer requested a return for order #${r.order.id.slice(-6)} (${r.reason}).`,
      data: { screen: 'Returns', returnId: r.id },
      categoryId: 'return_requested',
    }).catch((e) => this.logger.warn(`return.requested push failed: ${(e as Error).message}`));
  }

  @OnEvent('return.approved')
  async onReturnApproved(payload: { returnId: string }) {
    const r = await this.prisma.return.findUnique({
      where: { id: payload.returnId },
      include: { buyer: { select: { id: true } } },
    });
    if (!r) return;
    await this.notifications.sendToUser(r.buyerUserId, {
      title: 'Return approved',
      body: `Your return has been approved. Drop off the package using the return label.`,
      data: { screen: 'Returns', returnId: r.id },
      categoryId: 'return_approved',
    }).catch((e) => this.logger.warn(`return.approved push failed: ${(e as Error).message}`));
  }

  @OnEvent('return.rejected')
  async onReturnRejected(payload: { returnId: string; sellerNote?: string }) {
    const r = await this.prisma.return.findUnique({ where: { id: payload.returnId } });
    if (!r) return;
    await this.notifications.sendToUser(r.buyerUserId, {
      title: 'Return rejected',
      body: payload.sellerNote
        ? `Seller rejected your return: ${payload.sellerNote.slice(0, 120)}`
        : 'Seller rejected your return. You can appeal via support.',
      data: { screen: 'Returns', returnId: r.id },
      categoryId: 'return_rejected',
    }).catch((e) => this.logger.warn(`return.rejected push failed: ${(e as Error).message}`));
  }

  @OnEvent('return.refunded')
  async onReturnRefunded(payload: { returnId: string; orderId: string }) {
    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      select: { id: true, userId: true, totalMinor: true, currency: true },
    });
    if (!order) return;
    await this.notifications.sendToUser(order.userId, {
      title: 'Refund issued',
      body: `Your refund for order #${order.id.slice(-6)} has been issued.`,
      data: { screen: 'Order', orderId: order.id },
      categoryId: 'return_refunded',
    }).catch((e) => this.logger.warn(`return.refunded push failed: ${(e as Error).message}`));
  }

  @OnEvent('review.posted')
  async onReviewPosted(payload: { reviewId: string; productId: string }) {
    const review = await this.prisma.review.findUnique({
      where: { id: payload.reviewId },
      include: { product: { select: { sellerId: true, title: true, seller: { select: { userId: true } } } } },
    });
    if (!review) return;
    await this.notifications.sendToUser(review.product.seller.userId, {
      title: 'New review',
      body: `${review.rating}★ on "${review.product.title.slice(0, 60)}"`,
      data: { screen: 'Reviews', reviewId: review.id },
      categoryId: 'review_posted',
    }).catch((e) => this.logger.warn(`review.posted push failed: ${(e as Error).message}`));
  }

  @OnEvent('dispute.opened')
  async onDisputeOpened(payload: { disputeId: string; kind: string }) {
    const d = await this.prisma.dispute.findUnique({
      where: { id: payload.disputeId },
      include: {
        thread: { include: { order: { select: { userId: true, id: true } }, seller: { select: { userId: true } } } },
      },
    });
    if (!d || !d.thread) return;
    // Notify both parties; CHARGEBACK skips the buyer (they triggered it externally).
    const notifyBuyer = payload.kind !== 'CHARGEBACK';
    if (notifyBuyer) {
      await this.notifications.sendToUser(d.thread.buyerUserId, {
        title: 'Dispute opened',
        body: 'A dispute has been opened for your order. Support will be in touch.',
        data: { screen: 'Disputes', disputeId: d.id },
        categoryId: 'dispute_opened',
      }).catch((e) => this.logger.warn(`dispute.opened (buyer) push failed: ${(e as Error).message}`));
    }
    await this.notifications.sendToUser(d.thread.seller.userId, {
      title: 'Dispute opened',
      body: `A ${payload.kind.toLowerCase()} dispute has been opened. Please respond in your dashboard.`,
      data: { screen: 'Disputes', disputeId: d.id },
      categoryId: 'dispute_opened',
    }).catch((e) => this.logger.warn(`dispute.opened (seller) push failed: ${(e as Error).message}`));
  }

  @OnEvent('dispute.resolved')
  async onDisputeResolved(payload: { disputeId: string; outcome: string }) {
    const d = await this.prisma.dispute.findUnique({
      where: { id: payload.disputeId },
      include: {
        thread: { include: { order: { select: { userId: true } }, seller: { select: { userId: true } } } },
      },
    });
    if (!d || !d.thread) return;
    const body = `Outcome: ${payload.outcome.replace(/_/g, ' ').toLowerCase()}`;
    await Promise.all([
      this.notifications.sendToUser(d.thread.buyerUserId, {
        title: 'Dispute resolved', body, data: { screen: 'Disputes', disputeId: d.id },
        categoryId: 'dispute_resolved',
      }).catch((e) => this.logger.warn(`dispute.resolved (buyer) failed: ${(e as Error).message}`)),
      this.notifications.sendToUser(d.thread.seller.userId, {
        title: 'Dispute resolved', body, data: { screen: 'Disputes', disputeId: d.id },
        categoryId: 'dispute_resolved',
      }).catch((e) => this.logger.warn(`dispute.resolved (seller) failed: ${(e as Error).message}`)),
    ]);
  }
}

function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}
