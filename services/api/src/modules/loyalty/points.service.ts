import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PointsTransactionKind, type PointsTransaction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { WalletService } from '../wallet/wallet.service';
import { MembershipService } from './membership.service';

interface ApplyDeltaInput {
  userId: string;
  amount: number;
  kind: PointsTransactionKind;
  reason: string;
  referenceKey?: string;
  orderId?: string;
}

@Injectable()
export class PointsService {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly membership: MembershipService,
    private readonly cfg: ConfigService,
  ) {}

  // ---------------- account access ----------------

  async getOrCreate(userId: string) {
    const existing = await this.prisma.pointsAccount.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.pointsAccount.create({
      data: { id: newId(), userId, balance: 0, currency: 'USD' },
    });
  }

  async balance(userId: string): Promise<number> {
    const a = await this.prisma.pointsAccount.findUnique({ where: { userId } });
    return a?.balance ?? 0;
  }

  async statement(userId: string) {
    const account = await this.getOrCreate(userId);
    const txns = await this.prisma.pointsTransaction.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      balance: account.balance,
      transactions: txns.map((t) => ({
        id: t.id,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        kind: t.kind,
        reason: t.reason,
        referenceKey: t.referenceKey,
        orderId: t.orderId,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }

  // ---------------- writes ----------------

  /**
   * Same lost-update protection as Phase 10 wallet: read prior balance
   * inside a Prisma transaction, write the txn row with the cached
   * balanceAfter, update the account. Returns the new balance, or null
   * when the write was a no-op due to a duplicate referenceKey.
   */
  async applyDelta(input: ApplyDeltaInput): Promise<number | null> {
    if (input.amount === 0) throw new BadRequestException('amount must be non-zero');
    if (input.referenceKey) {
      const dup = await this.prisma.pointsTransaction.findUnique({
        where: { referenceKey: input.referenceKey },
      });
      if (dup) return null;
    }
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.pointsAccount.upsert({
        where: { userId: input.userId },
        create: { id: newId(), userId: input.userId, balance: 0, currency: 'USD' },
        update: {},
      });
      const newBalance = account.balance + input.amount;
      if (newBalance < 0) throw new BadRequestException('Insufficient points');
      await tx.pointsTransaction.create({
        data: {
          id: newId(),
          accountId: account.id,
          amount: input.amount,
          kind: input.kind,
          balanceAfter: newBalance,
          reason: input.reason,
          referenceKey: input.referenceKey ?? null,
          orderId: input.orderId ?? null,
        },
      });
      await tx.pointsAccount.update({
        where: { id: account.id },
        data: { balance: newBalance },
      });
      return newBalance;
    }).catch((e: unknown) => {
      // P2002 = unique violation on referenceKey — treat as idempotent no-op.
      if ((e as { code?: string })?.code === 'P2002') return null;
      throw e;
    });
  }

  // ---------------- earn ----------------

  /**
   * Award points for an order's paid event. Multipliers:
   *   - base = floor(subtotalMinor / 100) — 1 pt per $1
   *   - refurb/openbox lines double their own subtotal contribution
   *   - ACTIVE Plus member at award time gets ×1.5 on the total
   */
  async awardForOrder(input: {
    userId: string;
    orderId: string;
    subtotalMinor: number;
    refurbAndOpenboxSubtotalMinor: number;
  }) {
    const refurbDouble = Math.max(0, input.refurbAndOpenboxSubtotalMinor);
    const adjustedSubtotalMinor = input.subtotalMinor + refurbDouble; // add a second copy of refurb subtotal
    const base = Math.floor(adjustedSubtotalMinor / 100);
    const isPlus = await this.membership.isActiveForUser(input.userId);
    const final = Math.floor(base * (isPlus ? 1.5 : 1));
    if (final <= 0) return 0;
    const newBal = await this.applyDelta({
      userId: input.userId,
      amount: final,
      kind: refurbDouble > 0 ? PointsTransactionKind.EARN_REFURB : PointsTransactionKind.EARN_PURCHASE,
      reason: `Order ${input.orderId} (${isPlus ? 'Plus ' : ''}base ${base})`,
      referenceKey: `purchase:${input.orderId}`,
      orderId: input.orderId,
    });
    return newBal ?? 0;
  }

  /** Flat bonus for trade-in payouts. */
  awardForTradeIn(userId: string, orderId: string) {
    const amount = Number(this.cfg.get<string>('LOYALTY_POINTS_TRADEIN') ?? '200');
    return this.applyDelta({
      userId,
      amount,
      kind: PointsTransactionKind.EARN_TRADEIN,
      reason: `Trade-in ${orderId}`,
      referenceKey: `tradein:${orderId}`,
    });
  }

  /** Flat bonus on repair completion. */
  awardForRepair(userId: string, ticketId: string) {
    const amount = Number(this.cfg.get<string>('LOYALTY_POINTS_REPAIR') ?? '100');
    return this.applyDelta({
      userId,
      amount,
      kind: PointsTransactionKind.EARN_REPAIR,
      reason: `Repair ${ticketId}`,
      referenceKey: `repair:${ticketId}`,
    });
  }

  // ---------------- redeem ----------------

  /**
   * Convert points to wallet credit. Default 100 pts = 100 cents = $1
   * (configurable via LOYALTY_REDEEM_BPS). Minimum 100 pts, multiples of 100.
   */
  async redeemToWallet(userId: string, points: number) {
    if (points < 100 || points % 100 !== 0) {
      throw new BadRequestException('Redeem 100 points minimum, multiples of 100');
    }
    const bps = Number(this.cfg.get<string>('LOYALTY_REDEEM_BPS') ?? '100');
    const creditMinor = Math.floor((points / 100) * bps);
    if (creditMinor <= 0) throw new BadRequestException('Redemption value is zero');
    const txId = newId();
    const newPointsBal = await this.applyDelta({
      userId,
      amount: -points,
      kind: PointsTransactionKind.REDEEM_WALLET,
      reason: `Redeemed ${points} pts for wallet credit`,
      referenceKey: `redeem:${txId}`,
    });
    if (newPointsBal === null) {
      throw new BadRequestException('Redemption already processed');
    }
    await this.wallet.applyDelta({
      userId,
      amountMinor: creditMinor,
      kind: 'CREDIT_GRANT',
      reason: `Points redemption (${points} pts)`,
    });
    return { pointsBalance: newPointsBal, walletCreditedMinor: creditMinor };
  }
}
