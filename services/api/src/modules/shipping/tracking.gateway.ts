import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ShippingService } from './shipping.service';

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  path: '/socket.io',
})
export class TrackingGateway {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(TrackingGateway.name);

  constructor(private readonly shipping: ShippingService) {}

  /** Buyer / shipping-web join room by shipment id or public tracking token. */
  @SubscribeMessage('track:subscribe')
  async onSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { shipmentId?: string; publicToken?: string },
  ) {
    try {
      if (body.shipmentId) {
        client.join(`shipment:${body.shipmentId}`);
        return { ok: true, room: `shipment:${body.shipmentId}` };
      }
      if (body.publicToken) {
        const view = await this.shipping.getByPublicToken(body.publicToken);
        client.join(`shipment:${view.id}`);
        return { ok: true, room: `shipment:${view.id}` };
      }
      return { ok: false, error: 'no key' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  @OnEvent('shipment.updated')
  async onShipmentUpdated(payload: { shipmentId: string }) {
    if (!this.server) return;
    try {
      const fresh = await this.shipping.getById(payload.shipmentId, { userId: '_system', role: 'ADMIN' });
      this.server.to(`shipment:${payload.shipmentId}`).emit('shipment:update', {
        shipmentId: payload.shipmentId,
        status: fresh.status,
        events: fresh.events,
      });
    } catch (e) {
      this.logger.warn(`broadcast failed: ${(e as Error).message}`);
    }
  }
}
