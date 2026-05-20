import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { ReturnsService } from './returns.service';

/**
 * The return-leg shipment doesn't have a Shipment row (the outbound shipment
 * owns the orderId @unique slot — return carrier metadata is inline on Return).
 * That means the Phase 2 `shipment.updated` event doesn't fire for return-leg
 * scans. We expose `markReturnShipped` for carrier webhook handlers to call
 * directly with the return's `returnPublicToken`, and we also offer a manual
 * "buyer dropped off" trigger via the API.
 */
@Injectable()
export class ReturnsListener {
  private readonly logger = new Logger(ReturnsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly returns: ReturnsService,
  ) {}

  /**
   * Called from a carrier webhook adapter after it correlates a tracking number
   * back to a Return row (lookup by `returnTrackingNumber` + `returnPublicToken`).
   * Subscribes through the events module so the carrier adapter doesn't need a
   * direct dependency on the returns service.
   */
  @OnEvent('return.carrier.pickup')
  async onCarrierPickup(payload: { returnPublicToken: string }) {
    const ret = await this.prisma.return.findUnique({
      where: { returnPublicToken: payload.returnPublicToken },
    });
    if (!ret) return;
    try { await this.returns.onReturnCarrierPickup(ret.id); }
    catch (e) { this.logger.warn(`carrier pickup refund failed: ${(e as Error).message}`); }
  }
}
