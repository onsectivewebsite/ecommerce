import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { LedgerAccountKind, LedgerDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';

export interface PostingEntry {
  kind: LedgerAccountKind;
  sellerId?: string | null;
  direction: LedgerDirection;
  amountMinor: number;
  currency?: string;
  note?: string;
}

export interface PostingInput {
  txnId?: string;            // omit to auto-generate; pass to make idempotent across retries
  refType?: string;
  refId?: string;
  entries: PostingEntry[];
  occurredAt?: Date;
}

export interface AccountBalance {
  accountId: string;
  kind: LedgerAccountKind;
  sellerId: string | null;
  currency: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number; // credit - debit
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Post a balanced set of entries. Rejects if DEBIT total != CREDIT total within the same currency.
   * Idempotent on `txnId` — duplicate posts return the existing rows.
   */
  async post(input: PostingInput) {
    if (!input.entries.length) throw new BadRequestException('No entries');
    const txnId = input.txnId ?? newId();

    // Idempotency: if any row already exists with this txnId, return existing.
    const existing = await this.prisma.ledgerEntry.findMany({ where: { txnId } });
    if (existing.length) return existing;

    // Balance check, per currency.
    const sums = new Map<string, { debit: number; credit: number }>();
    for (const e of input.entries) {
      const cur = e.currency ?? 'USD';
      const bucket = sums.get(cur) ?? { debit: 0, credit: 0 };
      if (e.direction === 'DEBIT') bucket.debit += e.amountMinor;
      else bucket.credit += e.amountMinor;
      sums.set(cur, bucket);
    }
    for (const [cur, { debit, credit }] of sums.entries()) {
      if (debit !== credit) {
        throw new BadRequestException(`Unbalanced ledger posting in ${cur}: DEBIT ${debit} != CREDIT ${credit}`);
      }
    }

    const occurredAt = input.occurredAt ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      const created: any[] = [];
      for (const e of input.entries) {
        const acct = await this.ensureAccount(tx, e.kind, e.sellerId ?? null, e.currency ?? 'USD');
        const row = await tx.ledgerEntry.create({
          data: {
            id: newId(),
            accountId: acct.id,
            direction: e.direction,
            amountMinor: e.amountMinor,
            currency: e.currency ?? 'USD',
            txnId,
            refType: input.refType,
            refId: input.refId,
            note: e.note,
            occurredAt,
          },
        });
        created.push(row);
      }
      return created;
    });
  }

  async accountFor(kind: LedgerAccountKind, sellerId: string | null, currency = 'USD') {
    return this.ensureAccount(this.prisma, kind, sellerId, currency);
  }

  private async ensureAccount(
    tx: any,
    kind: LedgerAccountKind,
    sellerId: string | null,
    currency: string,
  ) {
    const existing = await tx.ledgerAccount.findUnique({
      where: { kind_sellerId_currency: { kind, sellerId, currency } },
    });
    if (existing) return existing;
    return tx.ledgerAccount.create({
      data: { id: newId(), kind, sellerId, currency },
    });
  }

  async balanceOf(kind: LedgerAccountKind, sellerId: string | null, currency = 'USD'): Promise<AccountBalance> {
    const acct = await this.accountFor(kind, sellerId, currency);
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where: { accountId: acct.id },
      _sum: { amountMinor: true },
    });
    let debit = 0, credit = 0;
    for (const r of rows) {
      if (r.direction === 'DEBIT') debit = r._sum.amountMinor ?? 0;
      else credit = r._sum.amountMinor ?? 0;
    }
    return {
      accountId: acct.id,
      kind,
      sellerId,
      currency,
      debitMinor: debit,
      creditMinor: credit,
      balanceMinor: credit - debit,
    };
  }

  /** Sum across all accounts of a kind (e.g. all SELLER_PAYABLE balances). */
  async kindTotal(kind: LedgerAccountKind, currency = 'USD'): Promise<number> {
    const accts = await this.prisma.ledgerAccount.findMany({ where: { kind, currency } });
    if (!accts.length) return 0;
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where: { accountId: { in: accts.map((a) => a.id) } },
      _sum: { amountMinor: true },
    });
    let d = 0, c = 0;
    for (const r of rows) {
      if (r.direction === 'DEBIT') d = r._sum.amountMinor ?? 0;
      else c = r._sum.amountMinor ?? 0;
    }
    return c - d;
  }

  // ----- Higher-level helpers used across the codebase -----

  async bookOrderPaid(args: {
    orderId: string; sellerId: string; grossMinor: number; commissionMinor: number; currency: string;
  }) {
    const sellerNet = args.grossMinor - args.commissionMinor;
    return this.post({
      txnId: `order:${args.orderId}:paid`,
      refType: 'order',
      refId: args.orderId,
      entries: [
        { kind: 'PLATFORM_CLEARING', sellerId: null, direction: 'DEBIT',  amountMinor: args.grossMinor,      currency: args.currency, note: 'order gross in' },
        { kind: 'SELLER_PAYABLE',    sellerId: args.sellerId, direction: 'CREDIT', amountMinor: sellerNet,          currency: args.currency, note: 'order net' },
        { kind: 'PLATFORM_REVENUE',  sellerId: null, direction: 'CREDIT', amountMinor: args.commissionMinor, currency: args.currency, note: 'commission' },
      ],
    });
  }

  async bookOrderRefunded(args: {
    orderId: string; sellerId: string; grossMinor: number; commissionMinor: number; currency: string;
  }) {
    const sellerNet = args.grossMinor - args.commissionMinor;
    return this.post({
      txnId: `order:${args.orderId}:refunded`,
      refType: 'order',
      refId: args.orderId,
      entries: [
        { kind: 'SELLER_PAYABLE',    sellerId: args.sellerId, direction: 'DEBIT',  amountMinor: sellerNet,          currency: args.currency, note: 'refund reversal — seller net' },
        { kind: 'PLATFORM_REVENUE',  sellerId: null,          direction: 'DEBIT',  amountMinor: args.commissionMinor, currency: args.currency, note: 'refund reversal — commission' },
        { kind: 'BUYER_REFUND',      sellerId: null,          direction: 'CREDIT', amountMinor: args.grossMinor,      currency: args.currency, note: 'refund out' },
      ],
    });
  }

  async bookAdTopUp(args: { sellerId: string; amountMinor: number; currency: string; paymentRef: string }) {
    return this.post({
      txnId: `ad_topup:${args.paymentRef}`,
      refType: 'ad_topup',
      refId: args.paymentRef,
      entries: [
        { kind: 'PLATFORM_CLEARING', sellerId: null,          direction: 'DEBIT',  amountMinor: args.amountMinor, currency: args.currency, note: 'seller ad top-up cash in' },
        { kind: 'SELLER_AD_BUDGET',  sellerId: args.sellerId, direction: 'CREDIT', amountMinor: args.amountMinor, currency: args.currency, note: 'ad budget credit' },
      ],
    });
  }

  async bookAdCharge(args: { sellerId: string; eventId: string; amountMinor: number; currency: string }) {
    if (args.amountMinor <= 0) return [];
    return this.post({
      txnId: `ad_event:${args.eventId}`,
      refType: 'ad_event',
      refId: args.eventId,
      entries: [
        { kind: 'SELLER_AD_BUDGET',     sellerId: args.sellerId, direction: 'DEBIT',  amountMinor: args.amountMinor, currency: args.currency, note: 'ad charge' },
        { kind: 'PLATFORM_AD_REVENUE',  sellerId: null,          direction: 'CREDIT', amountMinor: args.amountMinor, currency: args.currency, note: 'ad revenue' },
      ],
    });
  }

  async bookPayout(args: { payoutId: string; sellerId: string; amountMinor: number; currency: string }) {
    return this.post({
      txnId: `payout:${args.payoutId}`,
      refType: 'payout',
      refId: args.payoutId,
      entries: [
        { kind: 'SELLER_PAYABLE', sellerId: args.sellerId, direction: 'DEBIT',  amountMinor: args.amountMinor, currency: args.currency, note: 'payout drained' },
        { kind: 'PAYOUT_SENT',    sellerId: null,          direction: 'CREDIT', amountMinor: args.amountMinor, currency: args.currency, note: 'payout sent' },
      ],
    });
  }
}
