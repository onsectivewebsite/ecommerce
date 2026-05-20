import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { DisputesService } from './disputes.service';

/**
 * Auto-open disputes when domain signals indicate fund-recovery is in question:
 *   - `payment.disputed` (Stripe charge.dispute.created) → CHARGEBACK
 *   - `return.escalated`                                  → RETURN
 *   - `shipment.missing_delivery`                         → MISSING_DELIVERY
 */
@Injectable()
export class DisputesListener {
  private readonly logger = new Logger(DisputesListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly disputes: DisputesService,
  ) {}

  @OnEvent('payment.disputed')
  async onPaymentDisputed(payload: { orderId: string; paymentId: string; reason?: string; amountMinor: number }) {
    try {
      await this.disputes.openInternal({
        kind: 'CHARGEBACK',
        orderId: payload.orderId,
        paymentId: payload.paymentId,
        reason: `Chargeback (${payload.reason ?? 'unknown'}) — ${(payload.amountMinor / 100).toFixed(2)}`,
      });
    } catch (e) {
      this.logger.warn(`auto-open chargeback dispute failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('return.escalated')
  async onReturnEscalated(payload: { returnId: string }) {
    const r = await this.prisma.return.findUnique({ where: { id: payload.returnId } });
    if (!r) return;
    try {
      await this.disputes.openInternal({
        kind: 'RETURN',
        orderId: r.orderId,
        returnId: r.id,
        reason: `Return escalated (${r.reason}) — buyer requesting refund`,
      });
    } catch (e) {
      this.logger.warn(`auto-open return dispute failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('shipment.missing_delivery')
  async onMissingDelivery(payload: { orderId: string }) {
    try {
      await this.disputes.openInternal({
        kind: 'MISSING_DELIVERY',
        orderId: payload.orderId,
        reason: 'Carrier marked delivered but buyer reports non-receipt',
      });
    } catch (e) {
      this.logger.warn(`auto-open missing-delivery dispute failed: ${(e as Error).message}`);
    }
  }
}
