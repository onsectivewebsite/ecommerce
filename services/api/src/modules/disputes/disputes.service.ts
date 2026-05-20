import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { MessagingService } from '../messaging/messaging.service';
import type { DisputeKind, DisputeStatus } from '@prisma/client';
import type { AssignDisputeDto, OpenDisputeDto, ResolveDisputeDto } from './dto';

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

/**
 * Dispute lifecycle. Disputes are first-class records that may attach to a
 * messaging thread, a return, a shipment, and/or a payment. We do not own the
 * funds movement — for buyer-favored outcomes we call PaymentsService.refundOrder
 * (or for CHARGEBACK we just track it, since funds already moved).
 */
@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly messaging: MessagingService,
  ) {}

  // ---------- open ----------

  /**
   * Open a dispute. Public path used by buyer (e.g., "item not received" after carrier
   * marks delivered). Returns/chargebacks are typically opened by listeners using openInternal.
   */
  async openByBuyer(buyerUserId: string, dto: OpenDisputeDto, actor: ActorMeta) {
    if (!dto.orderId) throw new BadRequestException('orderId required');
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: { payment: true, shipment: true },
    });
    if (!order || order.userId !== buyerUserId) throw new NotFoundException('Order not found');
    if (order.status === 'REFUNDED') throw new BadRequestException('Order already refunded');
    const threadId = await this.messaging.ensureThreadForOrder(order.id);
    const existing = await this.prisma.dispute.findUnique({ where: { threadId } });
    if (existing) throw new BadRequestException('A dispute already exists for this order');

    const dispute = await this.prisma.dispute.create({
      data: {
        id: newId(),
        kind: dto.kind,
        status: 'OPEN',
        threadId,
        shipmentId: order.shipment?.id ?? null,
        paymentId: order.payment?.id ?? null,
        openedByUserId: buyerUserId,
        resolutionNote: null,
        resolutionMinor: 0,
      },
    });
    await this.prisma.messageThread.update({
      where: { id: threadId }, data: { status: 'ESCALATED', escalatedAt: new Date() },
    });
    await this.messaging.postSystemMessage(threadId, `Dispute opened by buyer: ${dto.reason}`);
    await this.audit.record({
      actorUserId: actor.userId, action: 'dispute.open.buyer', entityType: 'Dispute', entityId: dispute.id,
      after: { kind: dispute.kind, threadId, reason: dto.reason },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('dispute.opened', { disputeId: dispute.id, kind: dispute.kind });
    this.events.emit('thread.escalated', { threadId });
    return dispute;
  }

  /** Used by listeners (return rejected after appeal, chargeback webhook, missing-delivery worker). */
  async openInternal(input: {
    kind: DisputeKind;
    orderId?: string;
    returnId?: string;
    paymentId?: string;
    reason: string;
  }) {
    let threadId: string | null = null;
    if (input.orderId) {
      threadId = await this.messaging.ensureThreadForOrder(input.orderId);
      const existing = await this.prisma.dispute.findUnique({ where: { threadId } });
      if (existing) return existing;
    }
    const order = input.orderId ? await this.prisma.order.findUnique({
      where: { id: input.orderId }, include: { payment: true, shipment: true },
    }) : null;
    const dispute = await this.prisma.dispute.create({
      data: {
        id: newId(),
        kind: input.kind,
        status: 'OPEN',
        threadId,
        returnId: input.returnId ?? null,
        shipmentId: order?.shipment?.id ?? null,
        paymentId: input.paymentId ?? order?.payment?.id ?? null,
        openedByUserId: null,
        resolutionNote: null,
        resolutionMinor: 0,
      },
    });
    if (threadId) {
      await this.prisma.messageThread.update({
        where: { id: threadId }, data: { status: 'ESCALATED', escalatedAt: new Date() },
      });
      await this.messaging.postSystemMessage(threadId, `Dispute opened: ${input.kind} — ${input.reason}`);
      this.events.emit('thread.escalated', { threadId });
    }
    this.events.emit('dispute.opened', { disputeId: dispute.id, kind: dispute.kind });
    return dispute;
  }

  // ---------- read ----------

  async listForAdmin(status?: DisputeStatus, kind?: DisputeKind, assignedTo?: string) {
    return this.prisma.dispute.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(kind ? { kind } : {}),
        ...(assignedTo ? { assignedAdminId: assignedTo } : {}),
      },
      orderBy: [{ status: 'asc' }, { openedAt: 'asc' }],
      include: {
        thread: { include: { order: { select: { id: true, userId: true, totalMinor: true, currency: true } } } },
        return: { select: { id: true, status: true, reason: true } },
      },
      take: 200,
    });
  }

  async getById(id: string) {
    const d = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        thread: {
          include: {
            order: { select: { id: true, userId: true, totalMinor: true, currency: true, status: true } },
            messages: { orderBy: { createdAt: 'asc' }, take: 200 },
          },
        },
        return: true,
      },
    });
    if (!d) throw new NotFoundException('Dispute not found');
    return d;
  }

  // ---------- admin actions ----------

  async assign(id: string, dto: AssignDisputeDto, actor: ActorMeta) {
    const d = await this.prisma.dispute.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Dispute not found');
    const updated = await this.prisma.dispute.update({
      where: { id }, data: { assignedAdminId: dto.adminUserId },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'dispute.assign', entityType: 'Dispute', entityId: id,
      before: { assignedAdminId: d.assignedAdminId }, after: { assignedAdminId: dto.adminUserId },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  /**
   * Close a dispute. For RESOLVED_BUYER and RESOLVED_SPLIT we trigger a platform-funded
   * refund through PaymentsService.refundOrder using `resolutionMinor`.
   *
   * NOTE: CHARGEBACK kind never refunds through us — the network already moved funds.
   * Closing a CHARGEBACK just records the outcome for accounting.
   */
  async resolve(id: string, dto: ResolveDisputeDto, actor: ActorMeta) {
    const d = await this.prisma.dispute.findUnique({
      where: { id }, include: { thread: { include: { order: true } } },
    });
    if (!d) throw new NotFoundException('Dispute not found');
    if (d.status !== 'OPEN') throw new BadRequestException('Dispute is not open');

    let refundResult: { providerRefundId?: string; full?: boolean } | null = null;
    const needsRefund =
      (dto.outcome === 'RESOLVED_BUYER' || dto.outcome === 'RESOLVED_SPLIT') &&
      d.kind !== 'CHARGEBACK' &&
      d.thread?.order;
    if (needsRefund) {
      const orderId = d.thread!.order!.id;
      const order = d.thread!.order!;
      const amount = dto.resolutionMinor && dto.resolutionMinor > 0
        ? dto.resolutionMinor
        : order.totalMinor;
      refundResult = await this.payments.refundOrder(orderId, amount, `dispute:${d.id}`);
    }

    const updated = await this.prisma.dispute.update({
      where: { id },
      data: {
        status: dto.outcome,
        resolutionNote: dto.note,
        resolutionMinor: dto.resolutionMinor ?? 0,
        resolvedAt: new Date(),
        assignedAdminId: d.assignedAdminId ?? actor.userId,
      },
    });
    if (d.threadId) {
      await this.prisma.messageThread.update({
        where: { id: d.threadId }, data: { status: 'RESOLVED', resolvedAt: new Date() },
      });
      const sysBody = refundResult
        ? `Dispute resolved (${dto.outcome}). Refund issued: ${refundResult.providerRefundId ?? 'pending'}.`
        : `Dispute resolved (${dto.outcome}). No refund issued.`;
      await this.messaging.postSystemMessage(d.threadId, sysBody);
      this.events.emit('thread.resolved', { threadId: d.threadId });
    }
    await this.audit.record({
      actorUserId: actor.userId, action: 'dispute.resolve', entityType: 'Dispute', entityId: id,
      before: { status: d.status }, after: { status: dto.outcome, refund: refundResult },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('dispute.resolved', { disputeId: id, outcome: dto.outcome });
    return { dispute: updated, refund: refundResult };
  }
}
