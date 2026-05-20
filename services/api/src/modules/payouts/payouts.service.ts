import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PayoutStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../audit/audit.service';
import { StripeConnectService } from './stripe-connect.service';
import { newId } from '../../common/id';

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly stripe: StripeConnectService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Compute and write Payout rows for every seller with a positive payable balance.
   * Idempotent on the (sellerId, periodEnd) unique constraint.
   */
  async runForPeriod(periodEnd: Date = new Date()): Promise<{ created: number; skipped: number }> {
    const sellers = await this.prisma.seller.findMany({ where: { status: 'APPROVED' } });
    let created = 0;
    let skipped = 0;
    for (const seller of sellers) {
      const balance = await this.ledger.balanceOf('SELLER_PAYABLE', seller.id, seller.payoutCurrency);
      if (balance.balanceMinor <= 0) { skipped++; continue; }
      const periodStart = await this.lastPayoutEnd(seller.id);
      const exists = await this.prisma.payout.findUnique({
        where: { sellerId_periodEnd: { sellerId: seller.id, periodEnd } },
      });
      if (exists) { skipped++; continue; }
      // Phase 29: only route to Connect when the seller's Connect account
      // is enabled (payoutsEnabled mirrors Stripe's `payouts_enabled` flag).
      // Sellers stuck in PENDING/RESTRICTED/REJECTED/DISABLED get a MANUAL
      // payout instead — admin can intervene once the seller resolves their
      // Stripe requirements.
      const method = seller.stripeConnectId && seller.payoutsEnabled && this.stripe.isLive()
        ? 'STRIPE_CONNECT'
        : 'MANUAL';
      await this.prisma.payout.create({
        data: {
          id: newId(),
          sellerId: seller.id,
          amountMinor: balance.balanceMinor,
          currency: seller.payoutCurrency,
          method,
          status: 'PENDING',
          periodStart,
          periodEnd,
        },
      });
      created++;
    }
    this.logger.log(`Payout run for ${periodEnd.toISOString()}: created=${created} skipped=${skipped}`);
    return { created, skipped };
  }

  /**
   * Execute a payout.
   *  - Stripe Connect: attempt the transfer FIRST; only post the ledger on success.
   *    A failed transfer must not drain SELLER_PAYABLE.
   *  - Manual: move to PROCESSING without posting the ledger; admin will mark PAID
   *    once the off-platform wire clears, at which point the ledger is booked.
   */
  async execute(id: string, actor: ActorMeta) {
    const before = await this.prisma.payout.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Payout not found');
    if (before.status !== 'PENDING') throw new BadRequestException(`Payout already ${before.status}`);
    const seller = await this.prisma.seller.findUnique({ where: { id: before.sellerId } });
    if (!seller) throw new BadRequestException('Seller missing');

    if (
      before.method === 'STRIPE_CONNECT' &&
      seller.stripeConnectId &&
      seller.payoutsEnabled &&
      this.stripe.isLive()
    ) {
      try {
        const t = await this.stripe.transfer({
          destinationAccountId: seller.stripeConnectId,
          amountMinor: before.amountMinor,
          currency: before.currency,
          metadata: { payoutId: before.id },
        });
        await this.ledger.bookPayout({
          payoutId: before.id,
          sellerId: before.sellerId,
          amountMinor: before.amountMinor,
          currency: before.currency,
        });
        const updated = await this.prisma.payout.update({
          where: { id },
          data: { status: 'PAID', externalRef: t.id, ledgerTxnId: `payout:${id}` },
        });
        await this.audit.record({
          actorUserId: actor.userId, action: 'payout.paid', entityType: 'Payout', entityId: id,
          before, after: updated, ip: actor.ip, userAgent: actor.userAgent,
        });
        this.events.emit('payout.paid', { payoutId: id });
        return updated;
      } catch (e) {
        const updated = await this.prisma.payout.update({
          where: { id },
          data: { status: 'FAILED', note: (e as Error).message },
        });
        await this.audit.record({
          actorUserId: actor.userId, action: 'payout.failed', entityType: 'Payout', entityId: id,
          before, after: updated, ip: actor.ip, userAgent: actor.userAgent,
        });
        return updated;
      }
    }

    // MANUAL path — no ledger entry yet.
    const updated = await this.prisma.payout.update({
      where: { id },
      data: { status: 'PROCESSING' },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'payout.processing', entityType: 'Payout', entityId: id,
      before, after: updated, ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  async markPaid(id: string, externalRef: string | undefined, actor: ActorMeta) {
    const before = await this.prisma.payout.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Payout not found');
    if (before.status === 'PAID') return before;
    // For manual payouts, the ledger hasn't been posted yet — do it now.
    if (!before.ledgerTxnId) {
      await this.ledger.bookPayout({
        payoutId: before.id,
        sellerId: before.sellerId,
        amountMinor: before.amountMinor,
        currency: before.currency,
      });
    }
    const updated = await this.prisma.payout.update({
      where: { id },
      data: {
        status: 'PAID',
        externalRef: externalRef ?? before.externalRef,
        ledgerTxnId: before.ledgerTxnId ?? `payout:${id}`,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'payout.mark_paid', entityType: 'Payout', entityId: id,
      before, after: updated, ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('payout.paid', { payoutId: id });
    return updated;
  }

  async list(status?: PayoutStatus) {
    return this.prisma.payout.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { seller: true },
      take: 200,
    });
  }

  async listForSeller(userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('No seller profile');
    return this.prisma.payout.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async lastPayoutEnd(sellerId: string): Promise<Date> {
    const last = await this.prisma.payout.findFirst({
      where: { sellerId },
      orderBy: { periodEnd: 'desc' },
    });
    return last?.periodEnd ?? new Date(0);
  }
}
