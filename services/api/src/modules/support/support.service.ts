import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { MessagingService } from '../messaging/messaging.service';
import type { EscalateDto, InternalNoteDto, PlatformRefundDto } from './dto';

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

/**
 * Admin support inbox.
 *
 * SLA: a thread is "past SLA" if it has been in WAITING_SELLER for more than
 * SUPPORT_SELLER_SLA_HOURS (default 48h). Platform-funded refunds are gated on
 * this: a buyer can only get the platform to fund a refund if the seller has
 * failed to respond in time (or admin uses override=true).
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly slaHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly messaging: MessagingService,
  ) {
    this.slaHours = Number(process.env.SUPPORT_SELLER_SLA_HOURS ?? '48');
  }

  // ---------- inbox listing ----------

  /**
   * Admin queue. Default: anything ESCALATED, plus WAITING_SELLER threads that
   * have been waiting past SLA (those are the threads where the buyer is stuck).
   */
  async inbox(filter?: 'escalated' | 'past_sla' | 'all') {
    const slaCutoff = new Date(Date.now() - this.slaHours * 3600_000);
    const where = (() => {
      switch (filter) {
        case 'escalated': return { status: 'ESCALATED' as const };
        case 'past_sla': return { status: 'WAITING_SELLER' as const, lastMessageAt: { lt: slaCutoff } };
        case 'all':      return {};
        default:         return {
          OR: [
            { status: 'ESCALATED' as const },
            { status: 'WAITING_SELLER' as const, lastMessageAt: { lt: slaCutoff } },
          ],
        };
      }
    })();
    const threads = await this.prisma.messageThread.findMany({
      where,
      orderBy: [{ status: 'asc' }, { lastMessageAt: 'asc' }],
      include: {
        order: { select: { id: true, userId: true, totalMinor: true, currency: true, status: true } },
        seller: { select: { id: true, displayName: true } },
        dispute: { select: { id: true, kind: true, status: true } },
      },
      take: 200,
    });
    return threads.map((t) => ({
      ...t,
      slaBreached: t.status === 'WAITING_SELLER' && t.lastMessageAt < slaCutoff,
      hoursSinceLast: Math.round((Date.now() - t.lastMessageAt.getTime()) / 3600_000),
    }));
  }

  async getThreadFull(threadId: string) {
    const t = await this.prisma.messageThread.findUnique({
      where: { id: threadId },
      include: {
        order: { include: { items: { include: { variant: true } }, payment: true, shipment: true } },
        seller: true,
        buyer: { select: { id: true, firstName: true, lastName: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        dispute: true,
      },
    });
    if (!t) throw new NotFoundException('Thread not found');
    return t;
  }

  // ---------- admin actions on threads ----------

  /** Internal note = a regular Message authored by the admin. We rely on the audit
   *  log for the "internal" classification (not visible to buyer/seller via REST). */
  async addInternalNote(threadId: string, dto: InternalNoteDto, actor: ActorMeta) {
    const thread = await this.prisma.messageThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('Thread not found');
    // Stored as SYSTEM message prefixed `[INTERNAL]` so the UI can filter it for buyer/seller.
    await this.messaging.postSystemMessage(threadId, `[INTERNAL] ${dto.body}`);
    await this.audit.record({
      actorUserId: actor.userId, action: 'support.note', entityType: 'MessageThread', entityId: threadId,
      after: { len: dto.body.length }, ip: actor.ip, userAgent: actor.userAgent,
    });
    return { ok: true };
  }

  async escalate(threadId: string, dto: EscalateDto, actor: ActorMeta) {
    const t = await this.prisma.messageThread.findUnique({ where: { id: threadId } });
    if (!t) throw new NotFoundException('Thread not found');
    await this.prisma.messageThread.update({
      where: { id: threadId },
      data: { status: 'ESCALATED', escalatedAt: t.escalatedAt ?? new Date() },
    });
    await this.messaging.postSystemMessage(threadId, `Escalated to admin: ${dto.reason}`);
    await this.audit.record({
      actorUserId: actor.userId, action: 'support.escalate', entityType: 'MessageThread', entityId: threadId,
      after: { reason: dto.reason }, ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('thread.escalated', { threadId });
    return { ok: true };
  }

  async resolve(threadId: string, actor: ActorMeta) {
    const t = await this.prisma.messageThread.findUnique({ where: { id: threadId } });
    if (!t) throw new NotFoundException('Thread not found');
    await this.prisma.messageThread.update({
      where: { id: threadId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    await this.messaging.postSystemMessage(threadId, 'Thread resolved by support.');
    await this.audit.record({
      actorUserId: actor.userId, action: 'support.resolve', entityType: 'MessageThread', entityId: threadId,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('thread.resolved', { threadId });
    return { ok: true };
  }

  // ---------- platform-funded refund ----------

  /**
   * One-click refund. Gated unless:
   *  - thread is ESCALATED, or
   *  - thread is WAITING_SELLER past SLA, or
   *  - admin passed override=true (logged with reason).
   */
  async platformRefund(threadId: string, dto: PlatformRefundDto, actor: ActorMeta) {
    const t = await this.prisma.messageThread.findUnique({
      where: { id: threadId },
      include: { order: { include: { payment: true } } },
    });
    if (!t) throw new NotFoundException('Thread not found');
    if (!t.order || !t.order.payment) throw new BadRequestException('Thread has no payable order');

    const slaCutoff = new Date(Date.now() - this.slaHours * 3600_000);
    const slaBreached = t.status === 'WAITING_SELLER' && t.lastMessageAt < slaCutoff;
    const escalated = t.status === 'ESCALATED';
    const allowed = escalated || slaBreached || dto.override === true;
    if (!allowed) {
      throw new ForbiddenException('Refund blocked: seller is still within SLA. Use override only if justified.');
    }

    const result = await this.payments.refundOrder(t.order.id, dto.amountMinor, `support:${dto.reason}`);
    await this.messaging.postSystemMessage(
      threadId,
      `Platform refund issued${dto.override ? ' (override)' : ''}: ${dto.reason}`,
    );
    await this.prisma.messageThread.update({
      where: { id: threadId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'support.platform_refund', entityType: 'Order', entityId: t.order.id,
      after: { amountMinor: dto.amountMinor, reason: dto.reason, override: !!dto.override, providerRefundId: result.providerRefundId },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('thread.resolved', { threadId });
    return { ok: true, providerRefundId: result.providerRefundId, full: result.full };
  }
}
