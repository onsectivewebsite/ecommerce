import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { MediaService } from '../media/media.service';
import { AuditService } from '../audit/audit.service';
import { ShippingService } from '../shipping/shipping.service';
import { PaymentsService } from '../payments/payments.service';
import { WalletService } from '../wallet/wallet.service';
import type { ApproveReturnDto, RejectReturnDto, RequestReturnDto } from './dto';

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const RETURN_WINDOW_DAYS = 30;

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly shipping: ShippingService,
    private readonly payments: PaymentsService,
    private readonly events: EventEmitter2,
    private readonly wallet: WalletService,
  ) {}

  // ---------- buyer ----------

  async request(buyerUserId: string, dto: RequestReturnDto, actor: ActorMeta) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: { items: true, shipment: true },
    });
    if (!order || order.userId !== buyerUserId) throw new NotFoundException('Order not found');
    if (order.status !== 'DELIVERED') {
      throw new BadRequestException('Returns are only available after delivery');
    }
    if (order.shipment?.deliveredAt) {
      const ageDays = (Date.now() - order.shipment.deliveredAt.getTime()) / 86400_000;
      if (ageDays > RETURN_WINDOW_DAYS) {
        throw new BadRequestException(`Return window of ${RETURN_WINDOW_DAYS} days has passed`);
      }
    }

    // Validate item membership + qty caps, compute per-item refund.
    const itemsById = new Map(order.items.map((i) => [i.id, i]));
    let totalRefundMinor = 0;
    const returnItemRows = dto.items.map((dtoItem) => {
      const oi = itemsById.get(dtoItem.orderItemId);
      if (!oi) throw new BadRequestException(`Order item ${dtoItem.orderItemId} not in this order`);
      if (dtoItem.qty < 1 || dtoItem.qty > oi.qty) {
        throw new BadRequestException(`qty for ${oi.productTitleSnapshot} must be 1..${oi.qty}`);
      }
      const refundMinor = oi.unitPriceMinor * dtoItem.qty;
      totalRefundMinor += refundMinor;
      return { id: newId(), orderItemId: oi.id, qty: dtoItem.qty, refundMinor };
    });

    // Prevent double-returning the same orderItem when already pending.
    const existing = await this.prisma.return.findFirst({
      where: {
        orderId: order.id,
        status: { in: ['REQUESTED', 'APPROVED', 'SHIPPED', 'RECEIVED'] },
      },
    });
    if (existing) throw new BadRequestException('A return is already in progress for this order');

    let photoKey: string | null = null;
    if (dto.photoBase64) {
      const buf = Buffer.from(dto.photoBase64, 'base64');
      if (buf.length === 0) throw new BadRequestException('Empty photo');
      if (buf.length > MAX_PHOTO_BYTES) {
        throw new BadRequestException(`Photo exceeds ${MAX_PHOTO_BYTES} bytes`);
      }
      const safeName = (dto.photoFileName ?? 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
      photoKey = `returns/${order.id}/${newId()}-${safeName}`;
      await this.media.putObject(photoKey, buf, guessContentType(safeName));
    }

    const created = await this.prisma.return.create({
      data: {
        id: newId(),
        orderId: order.id,
        buyerUserId,
        sellerId: order.sellerId,
        reason: dto.reason,
        buyerNote: dto.buyerNote ?? null,
        photoObjectKey: photoKey,
        status: 'REQUESTED',
        refundAmountMinor: totalRefundMinor,
        items: { create: returnItemRows },
      },
      include: { items: true },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'return.request',
      entityType: 'Return',
      entityId: created.id,
      after: { reason: created.reason, refundAmountMinor: totalRefundMinor, items: returnItemRows.length },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('return.requested', { returnId: created.id });
    return created;
  }

  async listForBuyer(userId: string) {
    return this.prisma.return.findMany({
      where: { buyerUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
  }

  async cancel(buyerUserId: string, returnId: string, actor: ActorMeta) {
    const ret = await this.prisma.return.findUnique({ where: { id: returnId } });
    if (!ret || ret.buyerUserId !== buyerUserId) throw new NotFoundException('Return not found');
    if (!['REQUESTED', 'APPROVED'].includes(ret.status)) {
      throw new BadRequestException(`Cannot cancel a return in status ${ret.status}`);
    }
    const updated = await this.prisma.return.update({
      where: { id: returnId },
      data: { status: 'CANCELLED' },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'return.cancel', entityType: 'Return', entityId: returnId,
      before: { status: ret.status }, after: { status: 'CANCELLED' },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  // ---------- seller ----------

  async listForSeller(sellerUserId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new NotFoundException('Seller profile required');
    return this.prisma.return.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
      include: { items: true, order: true },
    });
  }

  async approve(sellerUserId: string, returnId: string, dto: ApproveReturnDto, actor: ActorMeta) {
    const ret = await this.ownReturnAsSellerOrThrow(sellerUserId, returnId);
    if (ret.status !== 'REQUESTED') {
      throw new BadRequestException(`Cannot approve a return in status ${ret.status}`);
    }

    const label = await this.shipping.purchaseReturnLabel(ret.orderId);
    const updated = await this.prisma.return.update({
      where: { id: returnId },
      data: {
        status: 'APPROVED',
        sellerNote: dto.sellerNote ?? null,
        refundMethod: dto.refundMethod ?? 'ORIGINAL',
        returnCarrierCode: label.carrierCode,
        returnTrackingNumber: label.trackingNumber,
        returnLabelObjectKey: label.labelObjectKey,
        returnPublicToken: label.publicToken,
        approvedAt: new Date(),
      },
    });

    await this.audit.record({
      actorUserId: actor.userId, action: 'return.approve', entityType: 'Return', entityId: returnId,
      before: { status: ret.status },
      after: { status: 'APPROVED', refundMethod: updated.refundMethod, tracking: updated.returnTrackingNumber },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('return.approved', { returnId });
    return updated;
  }

  async reject(sellerUserId: string, returnId: string, dto: RejectReturnDto, actor: ActorMeta) {
    const ret = await this.ownReturnAsSellerOrThrow(sellerUserId, returnId);
    if (ret.status !== 'REQUESTED') {
      throw new BadRequestException(`Cannot reject a return in status ${ret.status}`);
    }
    const updated = await this.prisma.return.update({
      where: { id: returnId },
      data: { status: 'REJECTED', sellerNote: dto.sellerNote, rejectedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'return.reject', entityType: 'Return', entityId: returnId,
      before: { status: ret.status },
      after: { status: 'REJECTED', sellerNote: dto.sellerNote },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('return.rejected', { returnId, sellerNote: dto.sellerNote });
    return updated;
  }

  /**
   * Seller-side "I received the parcel" confirmation. Triggers the refund.
   * The default flow is on carrier-scan (see `onShipmentUpdated`), but the
   * seller can fast-track it if they've physically received the parcel before
   * the carrier scan propagates.
   */
  async markReceived(sellerUserId: string, returnId: string, actor: ActorMeta) {
    const ret = await this.ownReturnAsSellerOrThrow(sellerUserId, returnId);
    if (!['APPROVED', 'SHIPPED'].includes(ret.status)) {
      throw new BadRequestException(`Cannot receive a return in status ${ret.status}`);
    }
    return this.runRefund(returnId, actor, 'seller-confirm');
  }

  // ---------- shipment-driven path ----------

  /**
   * The Phase 2 ShippingService emits `shipment.updated` whenever the carrier
   * scans a parcel. We listen on the *return-leg* token (we don't have a
   * Shipment row, just the tracking number stored on the Return), so this is
   * exposed as a service method for the listener to call after correlating.
   *
   * Realistically: this path is called when the buyer drops off the parcel
   * (scan: `picked_up`) — that's our default refund trigger (see D-060 in spec).
   */
  async onReturnCarrierPickup(returnId: string) {
    const ret = await this.prisma.return.findUnique({ where: { id: returnId } });
    if (!ret) return;
    if (ret.status !== 'APPROVED') return; // idempotent
    await this.prisma.return.update({
      where: { id: returnId },
      data: { status: 'SHIPPED', returnShippedAt: new Date() },
    });
    // Phase 9: refund on drop-off (configurable; admin can override to require seller-receipt).
    await this.runRefund(returnId, { userId: '_system' }, 'carrier-scan');
  }

  /**
   * Buyer-driven "I dropped the parcel" trigger — same path as a real carrier
   * scan but with buyer-ownership check. Until carrier return-webhooks ship, this
   * is the manual fallback the buyer-web exposes.
   */
  async buyerDropoff(buyerUserId: string, returnId: string, actor: ActorMeta) {
    const ret = await this.prisma.return.findUnique({ where: { id: returnId } });
    if (!ret || ret.buyerUserId !== buyerUserId) throw new NotFoundException('Return not found');
    if (ret.status !== 'APPROVED') {
      throw new BadRequestException(`Cannot drop off a return in status ${ret.status}`);
    }
    await this.audit.record({
      actorUserId: actor.userId, action: 'return.dropoff', entityType: 'Return', entityId: returnId,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    await this.onReturnCarrierPickup(returnId);
    return { ok: true };
  }

  // ---------- admin ----------

  async adminList(status?: string) {
    return this.prisma.return.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { items: true, order: true, seller: true, buyer: true },
      take: 200,
    });
  }

  async adminForceRefund(returnId: string, actor: ActorMeta) {
    return this.runRefund(returnId, actor, 'admin-force');
  }

  // ---------- helpers ----------

  private async ownReturnAsSellerOrThrow(sellerUserId: string, returnId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new ForbiddenException('Seller profile required');
    const ret = await this.prisma.return.findUnique({ where: { id: returnId } });
    if (!ret || ret.sellerId !== seller.id) throw new NotFoundException('Return not found');
    return ret;
  }

  private async runRefund(returnId: string, actor: ActorMeta, trigger: 'seller-confirm' | 'carrier-scan' | 'admin-force') {
    const ret = await this.prisma.return.findUnique({ where: { id: returnId } });
    if (!ret) throw new NotFoundException('Return not found');
    if (ret.status === 'REFUNDED') return ret;

    try {
      let refundProviderRef: string;
      // Phase 10: STORE_CREDIT routes funds into the buyer's wallet instead of
      // back through the payment gateway. The buyer keeps the money in-platform
      // and the next checkout deducts from wallet balance. ORIGINAL keeps the
      // existing behavior of reversing the original capture.
      if (ret.refundMethod === 'STORE_CREDIT' && this.wallet) {
        const newBalance = await this.wallet.creditAsRefund(
          ret.buyerUserId, ret.refundAmountMinor, ret.id, ret.orderId,
        );
        refundProviderRef = `wallet:${newBalance}`;
      } else {
        const refund = await this.payments.refundOrder(ret.orderId, ret.refundAmountMinor, `RETURN:${ret.reason}`);
        refundProviderRef = refund.providerRefundId;
      }
      const updated = await this.prisma.return.update({
        where: { id: returnId },
        data: {
          status: 'REFUNDED',
          receivedAt: ret.receivedAt ?? new Date(),
          refundedAt: new Date(),
          refundProviderRef,
        },
      });
      await this.audit.record({
        actorUserId: actor.userId, action: 'return.refund', entityType: 'Return', entityId: returnId,
        before: { status: ret.status },
        after: { status: 'REFUNDED', refundProviderRef, refundMethod: ret.refundMethod, trigger },
        ip: actor.ip, userAgent: actor.userAgent,
      });
      this.events.emit('return.refunded', { returnId, orderId: ret.orderId, method: ret.refundMethod });
      return updated;
    } catch (e) {
      this.logger.error(`Refund failed for return ${returnId}: ${(e as Error).message}`);
      throw e;
    }
  }

  /** Presigned URL for buyer to download the return-label PDF (10-min TTL). */
  presignLabelFor(ret: { returnLabelObjectKey: string | null }) {
    if (!ret.returnLabelObjectKey) return null;
    return this.shipping.presignLabel(ret.returnLabelObjectKey, 600);
  }

  /** Buyer-facing wrapper: enforces ownership, returns the presigned URL + TTL. */
  async getLabelUrl(buyerUserId: string, returnId: string) {
    const ret = await this.prisma.return.findUnique({ where: { id: returnId } });
    if (!ret || ret.buyerUserId !== buyerUserId) throw new NotFoundException('Return not found');
    const url = this.presignLabelFor(ret);
    if (!url) throw new NotFoundException('Return label not available yet');
    return { url, expiresInSec: 600 };
  }
}

function guessContentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  return 'image/jpeg';
}
