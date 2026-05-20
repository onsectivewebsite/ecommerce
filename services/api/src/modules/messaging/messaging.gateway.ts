import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { MessagingService } from './messaging.service';

interface SocketUser { userId: string; role: 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER' }

/**
 * Live message fan-out. Clients authenticate via JWT passed in handshake
 * (`auth.token` or `?token=`), then `thread:subscribe` to a thread room.
 * REST endpoints in MessagingController remain the source of truth — this
 * gateway only pushes events; clients can degrade to polling cleanly.
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
  path: '/socket.io',
  namespace: 'messaging',
})
export class MessagingGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(MessagingGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly messaging: MessagingService,
  ) {}

  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.query?.token as string | undefined);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: SocketUser['role'] }>(token);
      (client.data as { user: SocketUser }).user = { userId: payload.sub, role: payload.role };
    } catch (e) {
      this.logger.warn(`messaging socket auth failed: ${(e as Error).message}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('thread:subscribe')
  async onSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { threadId: string },
  ) {
    const user = (client.data as { user?: SocketUser }).user;
    if (!user) return { ok: false, error: 'unauthenticated' };
    try {
      await this.messaging.assertParticipant(body.threadId, user.userId, user.role);
      client.join(`thread:${body.threadId}`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  @SubscribeMessage('thread:typing')
  onTyping(@ConnectedSocket() client: Socket, @MessageBody() body: { threadId: string; typing: boolean }) {
    const user = (client.data as { user?: SocketUser }).user;
    if (!user) return;
    client.to(`thread:${body.threadId}`).emit('thread:typing', {
      threadId: body.threadId,
      userId: user.userId,
      typing: !!body.typing,
    });
  }

  @OnEvent('message.new')
  async broadcast(payload: { threadId: string; messageId: string; senderKind: string }) {
    if (!this.server) return;
    this.server.to(`thread:${payload.threadId}`).emit('message:new', payload);
  }

  @OnEvent('thread.escalated')
  async broadcastEscalated(payload: { threadId: string }) {
    if (!this.server) return;
    this.server.to(`thread:${payload.threadId}`).emit('thread:escalated', payload);
  }

  @OnEvent('thread.resolved')
  async broadcastResolved(payload: { threadId: string }) {
    if (!this.server) return;
    this.server.to(`thread:${payload.threadId}`).emit('thread:resolved', payload);
  }
}
