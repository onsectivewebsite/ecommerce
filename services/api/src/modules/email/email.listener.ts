import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from './email.service';

/**
 * Mirrors NotificationsListener — every push category has a matching email
 * version. The shared event payload shape means we can reuse all the
 * resolution logic (look up order, look up seller, etc.) here without
 * forcing publishers to know about email at all.
 *
 * Failures are logged but never thrown; the originating domain transaction
 * has already committed by the time we run.
 */
@Injectable()
export class EmailListener {
  private readonly logger = new Logger(EmailListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @OnEvent('order.paid')
  async onOrderPaid(payload: { orderId: string }) {
    if (!payload.orderId || payload.orderId.startsWith('sub_') || payload.orderId.startsWith('ad_topup_')) return;
    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: { user: true },
    });
    if (!order) return;
    await this.email.sendToUser(order.userId, 'order_paid', {
      firstName: order.user.firstName,
      orderShort: order.id.slice(-6),
      total: (order.totalMinor / 100).toFixed(2),
      currency: order.currency,
      orderUrl: this.absoluteUrl(`/orders/${order.id}`),
    });
  }

  @OnEvent('shipment.updated')
  async onShipmentUpdated(payload: { shipmentId: string }) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: payload.shipmentId },
      include: {
        order: { include: { user: true } },
        events: { orderBy: { occurredAt: 'desc' }, take: 1 },
      },
    });
    if (!shipment || shipment.events.length === 0) return;
    const latest = shipment.events[0];
    const category = `shipment_${latest.code}`;
    await this.email.sendToUser(shipment.order.userId, category, {
      firstName: shipment.order.user.firstName,
      orderShort: shipment.order.id.slice(-6),
      label: latest.label,
      trackUrl: this.absoluteUrl(`/track/${shipment.publicToken}`),
      orderUrl: this.absoluteUrl(`/orders/${shipment.order.id}`),
    });
  }

  @OnEvent('payout.paid')
  async onPayoutPaid(payload: { payoutId: string }) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payload.payoutId },
      include: { seller: { include: { user: true } } },
    });
    if (!payout) return;
    await this.email.sendToUser(payout.seller.userId, 'payout_paid', {
      firstName: payout.seller.user.firstName,
      total: (payout.amountMinor / 100).toFixed(2),
      currency: payout.currency,
      payoutId: payout.id,
    });
  }

  @OnEvent('return.requested')
  async onReturnRequested(payload: { returnId: string }) {
    const r = await this.prisma.return.findUnique({
      where: { id: payload.returnId },
      include: { seller: { include: { user: true } }, order: true },
    });
    if (!r) return;
    await this.email.sendToUser(r.seller.userId, 'return_requested', {
      firstName: r.seller.user.firstName,
      orderShort: r.order.id.slice(-6),
      reason: r.reason,
    });
  }

  @OnEvent('return.approved')
  async onReturnApproved(payload: { returnId: string }) {
    const r = await this.prisma.return.findUnique({
      where: { id: payload.returnId },
      include: { buyer: true },
    });
    if (!r) return;
    await this.email.sendToUser(r.buyerUserId, 'return_approved', {
      firstName: r.buyer.firstName,
      returnUrl: this.absoluteUrl(`/account/returns`),
    });
  }

  @OnEvent('return.rejected')
  async onReturnRejected(payload: { returnId: string; sellerNote?: string }) {
    const r = await this.prisma.return.findUnique({
      where: { id: payload.returnId },
      include: { buyer: true },
    });
    if (!r) return;
    await this.email.sendToUser(r.buyerUserId, 'return_rejected', {
      firstName: r.buyer.firstName,
      sellerNote: payload.sellerNote ?? '',
    });
  }

  @OnEvent('return.refunded')
  async onReturnRefunded(payload: { returnId: string; orderId: string }) {
    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: { user: true },
    });
    if (!order) return;
    await this.email.sendToUser(order.userId, 'return_refunded', {
      firstName: order.user.firstName,
      orderShort: order.id.slice(-6),
    });
  }

  @OnEvent('review.posted')
  async onReviewPosted(payload: { reviewId: string }) {
    const review = await this.prisma.review.findUnique({
      where: { id: payload.reviewId },
      include: { product: { include: { seller: { include: { user: true } } } } },
    });
    if (!review) return;
    await this.email.sendToUser(review.product.seller.userId, 'review_posted', {
      rating: review.rating,
      productTitle: review.product.title,
    });
  }

  @OnEvent('dispute.opened')
  async onDisputeOpened(payload: { disputeId: string }) {
    const d = await this.prisma.dispute.findUnique({
      where: { id: payload.disputeId },
      include: { thread: { include: { seller: { select: { userId: true } } } } },
    });
    if (!d?.thread) return;
    await Promise.all([
      this.email.sendToUser(d.thread.buyerUserId, 'dispute_opened', {}),
      this.email.sendToUser(d.thread.seller.userId, 'dispute_opened', {}),
    ]);
  }

  @OnEvent('dispute.resolved')
  async onDisputeResolved(payload: { disputeId: string; outcome: string }) {
    const d = await this.prisma.dispute.findUnique({
      where: { id: payload.disputeId },
      include: { thread: { include: { seller: { select: { userId: true } } } } },
    });
    if (!d?.thread) return;
    const vars = { outcome: payload.outcome.replace(/_/g, ' ').toLowerCase() };
    await Promise.all([
      this.email.sendToUser(d.thread.buyerUserId, 'dispute_resolved', vars),
      this.email.sendToUser(d.thread.seller.userId, 'dispute_resolved', vars),
    ]);
  }

  // Phase 11 — new categories driven by Phase 10 features:

  @OnEvent('cart.recovery.queued')
  async onCartRecovery(payload: { cartId: string; userId: string; stage: 'FIRST_24H' | 'SECOND_72H'; incentive?: string }) {
    const category = payload.stage === 'FIRST_24H' ? 'cart_recovery_24h' : 'cart_recovery_72h';
    const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) return;
    await this.email.sendToUser(payload.userId, category, {
      firstName: user.firstName,
      cartUrl: this.absoluteUrl('/cart'),
      incentive: payload.incentive ?? '',
    });
  }

  @OnEvent('inventory.low_stock')
  async onLowStock(payload: { sellerUserId: string; variantName: string; velocity: number; daysUntilEmpty: number }) {
    await this.email.sendToUser(payload.sellerUserId, 'inventory_low_stock', {
      variantName: payload.variantName,
      velocity: payload.velocity.toFixed(2),
      daysUntilEmpty: payload.daysUntilEmpty.toFixed(1),
    });
  }

  private absoluteUrl(path: string): string {
    const base = process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000';
    return `${base.replace(/\/$/, '')}${path}`;
  }
}
