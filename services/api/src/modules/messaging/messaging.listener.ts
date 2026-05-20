import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Push notifications for new messages. Counter-party only (sender never gets
 * their own push). Per-thread mute flags suppress the push for that party.
 */
@Injectable()
export class MessagingListener {
  private readonly logger = new Logger(MessagingListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent('message.new')
  async onMessageNew(payload: { threadId: string; senderKind: 'BUYER' | 'SELLER' | 'ADMIN' | 'SYSTEM' }) {
    const thread = await this.prisma.messageThread.findUnique({
      where: { id: payload.threadId },
      include: { seller: { select: { userId: true, displayName: true } } },
    });
    if (!thread) return;

    // Decide which party to push.
    const pushBuyer = payload.senderKind !== 'BUYER' && !thread.mutedByBuyer;
    const pushSeller = payload.senderKind !== 'SELLER' && !thread.mutedBySeller;

    const lastMsg = await this.prisma.message.findFirst({
      where: { threadId: payload.threadId },
      orderBy: { createdAt: 'desc' },
    });
    if (!lastMsg) return;
    const preview = lastMsg.body.slice(0, 120) || (lastMsg.attachmentKeys.length ? '[attachment]' : '');

    const title =
      payload.senderKind === 'SYSTEM' ? 'Order update' :
      payload.senderKind === 'ADMIN'  ? 'Message from support' :
      payload.senderKind === 'SELLER' ? `Message from ${thread.seller.displayName ?? 'seller'}` :
      'Message from buyer';

    const data = { screen: 'Messages', threadId: payload.threadId, orderId: thread.orderId };

    if (pushBuyer) {
      await this.notifications.sendToUser(thread.buyerUserId, {
        title, body: preview, data, categoryId: 'message_new',
      }).catch((e) => this.logger.warn(`messaging push (buyer) failed: ${(e as Error).message}`));
    }
    if (pushSeller) {
      await this.notifications.sendToUser(thread.seller.userId, {
        title, body: preview, data, categoryId: 'message_new',
      }).catch((e) => this.logger.warn(`messaging push (seller) failed: ${(e as Error).message}`));
    }
  }
}
