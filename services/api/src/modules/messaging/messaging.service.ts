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
import { AuditService } from '../audit/audit.service';
import { MediaService } from '../media/media.service';
import type { MessageSenderKind } from '@prisma/client';
import type { PresignAttachmentDto, SendMessageDto } from './dto';

const ATTACHMENT_TTL_PUT = 600; // 10 min
const ATTACHMENT_TTL_GET = 300; // 5 min

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

/**
 * Per-order message threads. One thread per Order (unique), three party kinds
 * (BUYER / SELLER / ADMIN); SYSTEM messages are written by domain listeners.
 * Real-time fan-out happens in MessagingGateway via `message.new`.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  // ---------- thread lookup ----------

  /** Open-or-create the per-order thread; idempotent. Used both by buyer and seller entry points. */
  async ensureThreadForOrder(orderId: string): Promise<string> {
    const existing = await this.prisma.messageThread.findUnique({ where: { orderId } });
    if (existing) return existing.id;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        items: { select: { variant: { select: { product: { select: { sellerId: true } } } } }, take: 1 },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const sellerId = order.items[0]?.variant.product.sellerId;
    if (!sellerId) throw new BadRequestException('Order has no items — cannot start thread');
    // Create with a unique-key race-tolerance: if a concurrent caller beat us, fall through.
    try {
      const created = await this.prisma.messageThread.create({
        data: { id: newId(), orderId: order.id, buyerUserId: order.userId, sellerId, status: 'OPEN' },
      });
      return created.id;
    } catch (e) {
      const reread = await this.prisma.messageThread.findUnique({ where: { orderId } });
      if (reread) return reread.id;
      throw e;
    }
  }

  /** Resolve the party kind (BUYER/SELLER/ADMIN) and assert that this user can see the thread. */
  async assertParticipant(threadId: string, userId: string, role: 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER') {
    const thread = await this.prisma.messageThread.findUnique({
      where: { id: threadId },
      include: { seller: { select: { userId: true } } },
    });
    if (!thread) throw new NotFoundException('Thread not found');
    if (role === 'ADMIN') return { thread, kind: 'ADMIN' as const };
    if (thread.buyerUserId === userId) return { thread, kind: 'BUYER' as const };
    if (thread.seller.userId === userId) return { thread, kind: 'SELLER' as const };
    throw new ForbiddenException('Not a participant in this thread');
  }

  // ---------- read APIs ----------

  async getOrderThread(orderId: string, userId: string, role: 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER') {
    const threadId = await this.ensureThreadForOrder(orderId);
    return this.getThread(threadId, userId, role);
  }

  async getThread(threadId: string, userId: string, role: 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER') {
    const { thread, kind } = await this.assertParticipant(threadId, userId, role);
    const messages = await this.prisma.message.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    // Mark this party's unread counter to 0 + flip read flags on inbound messages.
    await this.markRead(thread.id, kind);
    return {
      id: thread.id,
      orderId: thread.orderId,
      status: thread.status,
      buyerUserId: thread.buyerUserId,
      sellerId: thread.sellerId,
      escalatedAt: thread.escalatedAt?.toISOString() ?? null,
      mutedSelf: kind === 'BUYER' ? thread.mutedByBuyer : kind === 'SELLER' ? thread.mutedBySeller : false,
      messages: messages.map((m) => ({
        id: m.id,
        senderKind: m.senderKind,
        senderUserId: m.senderUserId,
        body: m.body,
        attachments: m.attachmentKeys.map((k) => ({ key: k, url: this.media.presignGetUrl(k, ATTACHMENT_TTL_GET) })),
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async listMyThreads(userId: string, role: 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER') {
    if (role === 'BUYER') {
      return this.prisma.messageThread.findMany({
        where: { buyerUserId: userId },
        orderBy: { lastMessageAt: 'desc' },
        include: { order: { select: { id: true, totalMinor: true, currency: true, status: true } } },
        take: 100,
      });
    }
    if (role === 'SELLER') {
      const seller = await this.prisma.seller.findUnique({ where: { userId } });
      if (!seller) return [];
      return this.prisma.messageThread.findMany({
        where: { sellerId: seller.id },
        orderBy: { lastMessageAt: 'desc' },
        include: { order: { select: { id: true, totalMinor: true, currency: true, status: true } } },
        take: 100,
      });
    }
    // Admin sees the inbox queue separately (support module). Here we only serve thread fetches by id.
    return [];
  }

  // ---------- write APIs ----------

  async sendMessage(
    threadId: string,
    dto: SendMessageDto,
    actor: ActorMeta,
    role: 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER',
  ) {
    const { thread, kind } = await this.assertParticipant(threadId, actor.userId, role);
    if (thread.status === 'RESOLVED') {
      throw new BadRequestException('Thread is resolved — reopen via support to continue');
    }
    const body = (dto.body ?? '').trim();
    if (!body && (!dto.attachmentKeys || dto.attachmentKeys.length === 0)) {
      throw new BadRequestException('Message must have text or at least one attachment');
    }
    const message = await this.prisma.message.create({
      data: {
        id: newId(),
        threadId,
        senderKind: kind as MessageSenderKind,
        senderUserId: actor.userId,
        body,
        attachmentKeys: dto.attachmentKeys ?? [],
        readByBuyer: kind === 'BUYER',
        readBySeller: kind === 'SELLER',
      },
    });
    // Counter-party gets +1 unread; status auto-advances waiting flag.
    const nextStatus = kind === 'BUYER' ? 'WAITING_SELLER' : kind === 'SELLER' ? 'WAITING_BUYER' : thread.status;
    await this.prisma.messageThread.update({
      where: { id: threadId },
      data: {
        lastMessageAt: new Date(),
        status: thread.status === 'ESCALATED' ? 'ESCALATED' : nextStatus,
        unreadByBuyer: kind === 'BUYER' ? 0 : { increment: 1 },
        unreadBySeller: kind === 'SELLER' ? 0 : { increment: 1 },
      },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'message.send', entityType: 'MessageThread', entityId: threadId,
      after: { messageId: message.id, kind, len: body.length, attachments: message.attachmentKeys.length },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('message.new', {
      threadId,
      messageId: message.id,
      senderKind: kind,
      buyerUserId: thread.buyerUserId,
      sellerId: thread.sellerId,
    });
    return {
      id: message.id,
      threadId,
      senderKind: kind,
      body: message.body,
      attachments: message.attachmentKeys.map((k) => ({ key: k, url: this.media.presignGetUrl(k, ATTACHMENT_TTL_GET) })),
      createdAt: message.createdAt.toISOString(),
    };
  }

  /** SYSTEM messages — written by listeners on domain events (return.requested, dispute.opened, etc.). */
  async postSystemMessage(threadId: string, body: string) {
    await this.prisma.message.create({
      data: {
        id: newId(),
        threadId,
        senderKind: 'SYSTEM',
        senderUserId: null,
        body,
        attachmentKeys: [],
        readByBuyer: false,
        readBySeller: false,
      },
    });
    await this.prisma.messageThread.update({
      where: { id: threadId },
      data: {
        lastMessageAt: new Date(),
        unreadByBuyer: { increment: 1 },
        unreadBySeller: { increment: 1 },
      },
    });
    this.events.emit('message.new', { threadId, messageId: 'system', senderKind: 'SYSTEM' });
  }

  async markRead(threadId: string, kind: 'BUYER' | 'SELLER' | 'ADMIN') {
    if (kind === 'ADMIN') return; // admin reads don't reset participant counters
    if (kind === 'BUYER') {
      await this.prisma.$transaction([
        this.prisma.messageThread.update({ where: { id: threadId }, data: { unreadByBuyer: 0 } }),
        this.prisma.message.updateMany({ where: { threadId, readByBuyer: false }, data: { readByBuyer: true } }),
      ]);
    } else {
      await this.prisma.$transaction([
        this.prisma.messageThread.update({ where: { id: threadId }, data: { unreadBySeller: 0 } }),
        this.prisma.message.updateMany({ where: { threadId, readBySeller: false }, data: { readBySeller: true } }),
      ]);
    }
  }

  async setMute(threadId: string, userId: string, role: 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER', muted: boolean) {
    const { kind } = await this.assertParticipant(threadId, userId, role);
    if (kind === 'ADMIN') throw new BadRequestException('Admins cannot mute on behalf of parties');
    await this.prisma.messageThread.update({
      where: { id: threadId },
      data: kind === 'BUYER' ? { mutedByBuyer: muted } : { mutedBySeller: muted },
    });
    return { ok: true, muted };
  }

  // ---------- attachments ----------

  presignAttachmentUpload(threadId: string, dto: PresignAttachmentDto) {
    const safe = (dto.filename || 'attachment').replace(/[^\w.\-]+/g, '_').slice(0, 80);
    const key = `messaging/${threadId}/${Date.now()}_${newId()}_${safe}`;
    const url = this.media.presignPutUrl(key, ATTACHMENT_TTL_PUT);
    return { key, uploadUrl: url, contentType: dto.contentType };
  }
}
