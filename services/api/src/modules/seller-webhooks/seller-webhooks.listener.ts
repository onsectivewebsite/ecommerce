import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { SellerWebhooksService } from './seller-webhooks.service';

/**
 * Fan-out from domain events → seller webhook deliveries. Each handler
 * resolves the affected seller and enqueues a delivery row per subscribed
 * endpoint. The dispatcher scheduler then ships them with retries.
 *
 * Payload shape is deliberately stable and seller-public: we never include
 * platform-internal fields like commissionMinor in payloads.
 */
@Injectable()
export class SellerWebhooksListener {
  private readonly logger = new Logger(SellerWebhooksListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hooks: SellerWebhooksService,
  ) {}

  @OnEvent('order.placed')
  async onOrderPlaced(payload: { orderId: string }) {
    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: { items: true, shippingAddress: true },
    });
    if (!order) return;
    await this.hooks.enqueueForSeller(order.sellerId, 'ORDER_PLACED', this.orderPayload(order));
  }

  @OnEvent('order.paid')
  async onOrderPaid(payload: { orderId: string }) {
    if (!payload.orderId || payload.orderId.startsWith('sub_') || payload.orderId.startsWith('ad_topup_')) return;
    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: { items: true, shippingAddress: true },
    });
    if (!order) return;
    await this.hooks.enqueueForSeller(order.sellerId, 'ORDER_PAID', this.orderPayload(order));
  }

  @OnEvent('order.refunded')
  async onOrderRefunded(payload: { orderId: string }) {
    const order = await this.prisma.order.findUnique({ where: { id: payload.orderId } });
    if (!order) return;
    await this.hooks.enqueueForSeller(order.sellerId, 'ORDER_CANCELLED', {
      orderId: order.id, status: order.status,
    });
  }

  @OnEvent('shipment.updated')
  async onShipmentUpdated(payload: { shipmentId: string }) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: payload.shipmentId },
      include: {
        order: { select: { id: true, sellerId: true } },
        events: { orderBy: { occurredAt: 'desc' }, take: 1 },
      },
    });
    if (!shipment || shipment.events.length === 0) return;
    const code = shipment.events[0].code;
    if (code === 'label_created') {
      await this.hooks.enqueueForSeller(shipment.order.sellerId, 'SHIPMENT_LABEL_CREATED', {
        orderId: shipment.order.id, shipmentId: shipment.id,
        carrierCode: shipment.carrierCode, trackingNumber: shipment.trackingNumber,
      });
    } else if (code === 'delivered') {
      await this.hooks.enqueueForSeller(shipment.order.sellerId, 'SHIPMENT_DELIVERED', {
        orderId: shipment.order.id, shipmentId: shipment.id,
        deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
      });
    }
  }

  @OnEvent('return.requested')
  async onReturnRequested(payload: { returnId: string }) {
    const r = await this.prisma.return.findUnique({
      where: { id: payload.returnId },
      include: { items: true },
    });
    if (!r) return;
    await this.hooks.enqueueForSeller(r.sellerId, 'RETURN_REQUESTED', this.returnPayload(r));
  }

  @OnEvent('return.approved')
  async onReturnApproved(payload: { returnId: string }) {
    const r = await this.prisma.return.findUnique({ where: { id: payload.returnId } });
    if (!r) return;
    await this.hooks.enqueueForSeller(r.sellerId, 'RETURN_APPROVED', { returnId: r.id, orderId: r.orderId });
  }

  @OnEvent('return.refunded')
  async onReturnRefunded(payload: { returnId: string; orderId: string }) {
    const r = await this.prisma.return.findUnique({ where: { id: payload.returnId } });
    if (!r) return;
    await this.hooks.enqueueForSeller(r.sellerId, 'RETURN_REFUNDED', {
      returnId: r.id, orderId: r.orderId, refundAmountMinor: r.refundAmountMinor,
    });
  }

  @OnEvent('review.posted')
  async onReviewPosted(payload: { reviewId: string }) {
    const review = await this.prisma.review.findUnique({
      where: { id: payload.reviewId },
      include: { product: { select: { sellerId: true, id: true } } },
    });
    if (!review) return;
    await this.hooks.enqueueForSeller(review.product.sellerId, 'REVIEW_POSTED', {
      reviewId: review.id, productId: review.product.id,
      rating: review.rating, title: review.title, body: review.body,
    });
  }

  @OnEvent('payout.paid')
  async onPayoutPaid(payload: { payoutId: string }) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payload.payoutId } });
    if (!payout) return;
    await this.hooks.enqueueForSeller(payout.sellerId, 'PAYOUT_PAID', {
      payoutId: payout.id, amountMinor: payout.amountMinor, currency: payout.currency,
    });
  }

  // ---------- payload shapers ----------

  private orderPayload(order: any) {
    return {
      orderId: order.id,
      buyerUserId: order.userId,
      status: order.status,
      currency: order.currency,
      subtotalMinor: order.subtotalMinor,
      shippingMinor: order.shippingMinor,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      items: (order.items ?? []).map((i: any) => ({
        id: i.id,
        variantId: i.variantId,
        title: i.productTitleSnapshot,
        variant: i.variantNameSnapshot,
        unitPriceMinor: i.unitPriceMinor,
        qty: i.qty,
        lineSubtotalMinor: i.lineSubtotalMinor,
      })),
      shipTo: order.shippingAddress ? {
        country: order.shippingAddress.country,
        region: order.shippingAddress.region,
        postalCode: order.shippingAddress.postalCode,
      } : null,
      createdAt: order.createdAt.toISOString(),
    };
  }

  private returnPayload(r: any) {
    return {
      returnId: r.id,
      orderId: r.orderId,
      reason: r.reason,
      buyerNote: r.buyerNote,
      status: r.status,
      items: (r.items ?? []).map((i: any) => ({ orderItemId: i.orderItemId, quantity: i.quantity })),
      createdAt: r.createdAt.toISOString(),
    };
  }
}
