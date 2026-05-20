import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import type { WalletTxnKind } from '@prisma/client';

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

/**
 * Wallet / store-credit ledger.
 *
 * Every write goes through `applyDelta` which re-reads the prior balance
 * inside a Prisma transaction and asserts the cached `balanceAfterMinor` on
 * the new row equals `prior + amountMinor`. That assertion is what catches
 * lost-update bugs from concurrent writes.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getOrCreate(userId: string, currency = 'USD') {
    const existing = await this.prisma.walletAccount.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.walletAccount.create({
      data: { id: newId(), userId, currency, balanceMinor: 0 },
    });
  }

  async statement(userId: string) {
    const wallet = await this.getOrCreate(userId);
    const txns = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      currency: wallet.currency,
      balanceMinor: wallet.balanceMinor,
      transactions: txns.map((t) => ({
        id: t.id,
        kind: t.kind,
        amountMinor: t.amountMinor,
        balanceAfterMinor: t.balanceAfterMinor,
        reason: t.reason,
        orderId: t.orderId,
        returnId: t.returnId,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }

  // ---------- writes ----------

  /**
   * Apply a signed delta to a wallet. Negative = debit. Inside a transaction
   * we re-read the wallet, compute the new balance, write the txn row, and
   * patch the wallet's cached balance. Returns the new balance.
   */
  async applyDelta(input: {
    userId: string;
    amountMinor: number;
    kind: WalletTxnKind;
    reason: string;
    orderId?: string;
    returnId?: string;
    grantedByUserId?: string;
    currency?: string;
  }): Promise<number> {
    if (input.amountMinor === 0) throw new BadRequestException('amountMinor must be non-zero');

    return this.prisma.$transaction(async (tx) => {
      let wallet = await tx.walletAccount.findUnique({ where: { userId: input.userId } });
      if (!wallet) {
        wallet = await tx.walletAccount.create({
          data: { id: newId(), userId: input.userId, currency: input.currency ?? 'USD', balanceMinor: 0 },
        });
      }
      const next = wallet.balanceMinor + input.amountMinor;
      if (next < 0) throw new BadRequestException('Insufficient wallet balance');

      await tx.walletTransaction.create({
        data: {
          id: newId(),
          walletId: wallet.id,
          kind: input.kind,
          amountMinor: input.amountMinor,
          balanceAfterMinor: next,
          reason: input.reason,
          orderId: input.orderId ?? null,
          returnId: input.returnId ?? null,
          grantedByUserId: input.grantedByUserId ?? null,
        },
      });
      const updated = await tx.walletAccount.update({
        where: { id: wallet.id },
        data: { balanceMinor: next },
      });
      // Sanity check: the wallet's balance must now match our computed `next`.
      // If a concurrent writer beat us, the update succeeded but our balance
      // calc was based on stale state — bail so the txn rolls back.
      if (updated.balanceMinor !== next) {
        throw new Error(`Wallet balance race detected for ${wallet.id}`);
      }
      return next;
    });
  }

  // ---------- admin ----------

  async grant(adminUserId: string, dto: { targetUserId: string; amountMinor: number; reason: string; currency?: string }, actor: ActorMeta) {
    const newBalance = await this.applyDelta({
      userId: dto.targetUserId,
      amountMinor: dto.amountMinor,
      kind: 'CREDIT_GRANT',
      reason: dto.reason,
      grantedByUserId: adminUserId,
      currency: dto.currency,
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'wallet.grant', entityType: 'WalletAccount', entityId: dto.targetUserId,
      after: { amountMinor: dto.amountMinor, reason: dto.reason, newBalance },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return { newBalance };
  }

  // ---------- checkout / refund integration ----------

  async debitForCheckout(userId: string, amountMinor: number, orderId: string) {
    if (amountMinor <= 0) return 0;
    return this.applyDelta({
      userId, amountMinor: -amountMinor, kind: 'DEBIT_CHECKOUT',
      reason: `Applied to order ${orderId}`, orderId,
    });
  }

  async reverseCheckoutDebit(userId: string, amountMinor: number, orderId: string) {
    if (amountMinor <= 0) return 0;
    return this.applyDelta({
      userId, amountMinor: +amountMinor, kind: 'DEBIT_REVERSAL',
      reason: `Reversed debit for cancelled order ${orderId}`, orderId,
    });
  }

  async creditAsRefund(userId: string, amountMinor: number, returnId: string, orderId?: string) {
    if (amountMinor <= 0) throw new BadRequestException('amountMinor must be positive');
    return this.applyDelta({
      userId, amountMinor, kind: 'CREDIT_REFUND',
      reason: `Refund as store credit (return ${returnId})`,
      orderId, returnId,
    });
  }

  /**
   * Phase 14: warranty-claim payouts go to wallet credit. Avoids racing the
   * payment processor for an aged order and keeps the existing buyer flow.
   */
  async creditFromWarranty(
    userId: string,
    amountMinor: number,
    currency: string,
    claimId: string,
  ) {
    if (amountMinor <= 0) throw new BadRequestException('amountMinor must be positive');
    return this.applyDelta({
      userId, amountMinor, kind: 'CREDIT_REFUND', currency,
      reason: `Warranty resolution refund (claim ${claimId})`,
    });
  }

  // ---------- helpers ----------

  async balance(userId: string): Promise<number> {
    const w = await this.prisma.walletAccount.findUnique({ where: { userId } });
    return w?.balanceMinor ?? 0;
  }

  async assertSufficient(userId: string, amountMinor: number) {
    const bal = await this.balance(userId);
    if (bal < amountMinor) throw new BadRequestException(`Wallet balance ${bal} < requested ${amountMinor}`);
  }
}
