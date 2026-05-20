import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationKind, type Notification, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';

export interface WriteFeedInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  deepLinkPath?: string;
  payload?: Prisma.InputJsonValue;
}

export interface ListFeedInput {
  userId: string;
  /** ISO timestamp; rows older than this are returned. */
  cursor?: string;
  /** Default 50, max 200. */
  limit?: number;
  /** If true, return only rows where readAt is null. */
  unreadOnly?: boolean;
}

export interface ListFeedResult {
  rows: Notification[];
  nextCursor: string | null;
}

@Injectable()
export class NotificationFeedService {
  private readonly logger = new Logger(NotificationFeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Best-effort write. Errors are logged and swallowed so the calling
   * lifecycle event (order.paid, plus renewal, etc.) is never affected.
   * Returns the created row, or null on failure.
   */
  async write(input: WriteFeedInput): Promise<Notification | null> {
    try {
      const row = await this.prisma.notification.create({
        data: {
          id: newId(),
          userId: input.userId,
          kind: input.kind,
          title: input.title,
          body: input.body,
          deepLinkPath: input.deepLinkPath ?? null,
          payload: input.payload as Prisma.InputJsonValue | undefined,
        },
      });
      // Phase 27: emit on the internal bus so the (optional) realtime
      // gateway can fan it out to a per-user socket room. Listeners that
      // crash won't break this write.
      this.events.emit('notification.created', {
        userId: row.userId,
        notification: this.toApi(row),
      });
      return row;
    } catch (e) {
      this.logger.warn(`feed.write failed for ${input.userId}: ${(e as Error).message}`);
      return null;
    }
  }

  async list(input: ListFeedInput): Promise<ListFeedResult> {
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    const where: Prisma.NotificationWhereInput = { userId: input.userId };
    if (input.cursor) where.createdAt = { lt: new Date(input.cursor) };
    if (input.unreadOnly) where.readAt = null;
    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const overflow = rows.length > limit;
    const slice = overflow ? rows.slice(0, limit) : rows;
    return {
      rows: slice,
      nextCursor: overflow ? slice[slice.length - 1]!.createdAt.toISOString() : null,
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  async markRead(userId: string, id: string): Promise<{ ok: true }> {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    const r = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: r.count };
  }

  /** Trim the payload shape to what the api-client expects. */
  toApi(row: Notification) {
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      deepLinkPath: row.deepLinkPath,
      payload: row.payload,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
