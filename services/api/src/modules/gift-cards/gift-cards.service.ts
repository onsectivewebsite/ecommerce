import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GiftCard, GiftCardStatus, Prisma } from '@prisma/client';
import type { PaymentProvider } from '@onsective/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { WalletService } from '../wallet/wallet.service';
import { PaymentsService } from '../payments/payments.service';
import { renderTemplate } from '../email/templates';
import { newId } from '../../common/id';
import { generateGiftCardCode, normalizeGiftCardCode } from './gift-card-code';

/** Purchase amount bounds, in minor units (cents). */
const MIN_AMOUNT_MINOR = 500; // $5
const MAX_AMOUNT_MINOR = 100_000; // $1000

export interface ActorMeta {
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface PurchaseInput {
  amountMinor: number;
  currency?: string;
  recipientEmail: string;
  recipientName?: string;
  senderName?: string;
  message?: string;
  deliverAt?: string; // ISO
  paymentProvider?: PaymentProvider;
}

export interface AdminIssueInput {
  amountMinor: number;
  currency?: string;
  recipientEmail: string;
  recipientName?: string;
  senderName?: string;
  message?: string;
  expiresAt?: string; // ISO
}

@Injectable()
export class GiftCardsService {
  private readonly logger = new Logger(GiftCardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly wallet: WalletService,
    private readonly payments: PaymentsService,
    private readonly cfg: ConfigService,
  ) {}

  private get webUrl(): string {
    return (
      this.cfg.get<string>('BUYER_WEB_URL') ??
      this.cfg.get<string>('PUBLIC_WEB_URL') ??
      'http://localhost:3000'
    );
  }

  private money(minor: number, currency: string): string {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }

  private validateAmount(minor: number) {
    if (!Number.isInteger(minor) || minor < MIN_AMOUNT_MINOR || minor > MAX_AMOUNT_MINOR) {
      throw new BadRequestException(
        `Gift card amount must be between ${MIN_AMOUNT_MINOR / 100} and ${MAX_AMOUNT_MINOR / 100}`,
      );
    }
  }

  /** Generate a code, retrying on the (vanishingly rare) unique collision. */
  private async freshCode(): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const code = generateGiftCardCode();
      const exists = await this.prisma.giftCard.findUnique({ where: { code } });
      if (!exists) return code;
    }
    throw new ConflictException('Could not allocate a gift card code, please retry');
  }

  // ───────────────────────── Purchase ─────────────────────────

  async purchase(
    purchaserUserId: string,
    input: PurchaseInput,
  ): Promise<{ giftCardId: string; clientSecret: string | null; code: string }> {
    this.validateAmount(input.amountMinor);
    const currency = (input.currency ?? 'USD').toUpperCase();
    const buyer = await this.prisma.user.findUnique({ where: { id: purchaserUserId } });
    if (!buyer) throw new NotFoundException('Purchaser not found');

    let deliverAt: Date | null = null;
    if (input.deliverAt) {
      const d = new Date(input.deliverAt);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid deliverAt');
      // A past date just means "deliver immediately" — null it out.
      deliverAt = d.getTime() > Date.now() ? d : null;
    }

    const code = await this.freshCode();
    const card = await this.prisma.giftCard.create({
      data: {
        id: newId(),
        code,
        status: 'PENDING_PAYMENT',
        currency,
        initialAmountMinor: input.amountMinor,
        balanceMinor: input.amountMinor,
        purchaserUserId,
        recipientEmail: input.recipientEmail.toLowerCase(),
        recipientName: input.recipientName ?? null,
        senderName: input.senderName ?? `${buyer.firstName} ${buyer.lastName}`.trim(),
        message: input.message ?? null,
        deliverAt,
      },
    });

    const provider: PaymentProvider = input.paymentProvider ?? 'stripe';
    const gateway = this.payments.resolve(provider);
    const intent = await gateway.createIntent({
      giftCardId: card.id,
      amountMinor: input.amountMinor,
      currency,
      buyerEmail: buyer.email,
    });

    await this.prisma.giftCard.update({
      where: { id: card.id },
      data: { paymentRef: intent.providerRef },
    });

    await this.audit
      .record({
        actorUserId: purchaserUserId,
        action: 'giftcard.purchase.created',
        entityType: 'GiftCard',
        entityId: card.id,
        after: { amountMinor: input.amountMinor, currency, recipientEmail: card.recipientEmail },
      })
      .catch(() => undefined);

    return { giftCardId: card.id, clientSecret: intent.clientSecret ?? null, code };
  }

  /** Called by the listener on `giftcard.purchase.paid`. Idempotent. */
  async markPaid(giftCardId: string): Promise<void> {
    const card = await this.prisma.giftCard.findUnique({ where: { id: giftCardId } });
    if (!card) {
      this.logger.warn(`giftcard.purchase.paid for unknown card ${giftCardId}`);
      return;
    }
    if (card.status !== 'PENDING_PAYMENT') return; // already handled

    await this.prisma.giftCard.update({
      where: { id: card.id },
      data: { status: 'ACTIVE' },
    });

    await this.audit
      .record({
        actorUserId: card.purchaserUserId,
        action: 'giftcard.purchase.paid',
        entityType: 'GiftCard',
        entityId: card.id,
      })
      .catch(() => undefined);

    // Receipt to the purchaser.
    if (card.purchaserUserId) {
      await this.email
        .sendToUser(card.purchaserUserId, 'gift_card_purchase_receipt', {
          firstName: card.senderName ?? 'there',
          amount: this.money(card.initialAmountMinor, card.currency),
          currency: card.currency,
          recipientEmail: card.recipientEmail,
          deliveryLine: card.deliverAt
            ? `Scheduled for ${card.deliverAt.toUTCString()}`
            : 'Sent now',
          giftCardsUrl: `${this.webUrl}/account/gift-cards`,
        })
        .catch((e) => this.logger.warn(`gift_card receipt failed: ${e}`));
    }

    // Deliver immediately unless scheduled for the future.
    if (!card.deliverAt || card.deliverAt.getTime() <= Date.now()) {
      await this.deliver(card.id);
    }
  }

  /** Called by the listener on `giftcard.purchase.failed`. */
  async markFailed(giftCardId: string): Promise<void> {
    const card = await this.prisma.giftCard.findUnique({ where: { id: giftCardId } });
    if (!card || card.status !== 'PENDING_PAYMENT') return;
    await this.prisma.giftCard.update({
      where: { id: card.id },
      data: { status: 'VOID' },
    });
    await this.audit
      .record({
        actorUserId: card.purchaserUserId,
        action: 'giftcard.purchase.failed',
        entityType: 'GiftCard',
        entityId: card.id,
      })
      .catch(() => undefined);
  }

  // ───────────────────────── Delivery ─────────────────────────

  /** Email the recipient the code. Idempotent — skips if already delivered. */
  async deliver(giftCardId: string): Promise<void> {
    const card = await this.prisma.giftCard.findUnique({ where: { id: giftCardId } });
    if (!card || card.status !== 'ACTIVE' || card.deliveredAt) return;

    const tpl = renderTemplate('gift_card_received', {
      senderName: card.senderName ?? 'Someone',
      recipientGreeting: card.recipientName ? ` ${card.recipientName}` : '',
      amount: this.money(card.initialAmountMinor, card.currency),
      currency: card.currency,
      messageBlock: card.message ? `Their message:\n"${card.message}"\n\n` : '',
      code: card.code,
      redeemUrl: `${this.webUrl}/account/gift-cards?code=${encodeURIComponent(card.code)}`,
    });
    if (tpl) {
      await this.email
        .sendDirect(
          card.recipientEmail,
          card.recipientName ?? card.recipientEmail,
          'gift_card_received',
          tpl.subject,
          tpl.text,
          tpl.html,
        )
        .catch((e) => this.logger.warn(`gift_card_received send failed: ${e}`));
    }
    await this.prisma.giftCard.update({
      where: { id: card.id },
      data: { deliveredAt: new Date() },
    });
  }

  /** Scheduler hook: deliver all due, ACTIVE, not-yet-delivered cards. */
  async deliverDue(): Promise<{ delivered: number }> {
    const due = await this.prisma.giftCard.findMany({
      where: {
        status: 'ACTIVE',
        deliveredAt: null,
        deliverAt: { not: null, lte: new Date() },
      },
      take: 200,
    });
    let delivered = 0;
    for (const c of due) {
      try {
        await this.deliver(c.id);
        delivered++;
      } catch (e) {
        this.logger.warn(`deliver ${c.id} failed: ${(e as Error).message}`);
      }
    }
    return { delivered };
  }

  // ───────────────────────── Redemption ─────────────────────────

  /** Lazy-expire a card if past its expiry; returns the (possibly updated) row. */
  private async withLazyExpiry(card: GiftCard): Promise<GiftCard> {
    if (
      card.status === 'ACTIVE' &&
      card.expiresAt &&
      card.expiresAt.getTime() <= Date.now()
    ) {
      return this.prisma.giftCard.update({
        where: { id: card.id },
        data: { status: 'EXPIRED' },
      });
    }
    return card;
  }

  /** Read-only preview — does not mutate balance. */
  async check(rawCode: string) {
    const code = normalizeGiftCardCode(rawCode);
    const found = await this.prisma.giftCard.findUnique({ where: { code } });
    if (!found) throw new NotFoundException('Gift card not recognized');
    const card = await this.withLazyExpiry(found);
    return {
      status: card.status,
      balanceMinor: card.balanceMinor,
      currency: card.currency,
      expiresAt: card.expiresAt?.toISOString() ?? null,
      redeemable: card.status === 'ACTIVE' && card.balanceMinor > 0,
    };
  }

  /** Transfer the full remaining balance into the user's wallet. */
  async redeem(userId: string, rawCode: string) {
    const code = normalizeGiftCardCode(rawCode);
    const found = await this.prisma.giftCard.findUnique({ where: { code } });
    if (!found) throw new NotFoundException('Gift card not recognized');
    const card = await this.withLazyExpiry(found);

    if (card.status === 'REDEEMED') {
      throw new ConflictException('This gift card has already been redeemed');
    }
    if (card.status === 'PENDING_PAYMENT') {
      throw new BadRequestException('This gift card is not active yet');
    }
    if (card.status !== 'ACTIVE' || card.balanceMinor <= 0) {
      throw new BadRequestException(`This gift card is ${card.status.toLowerCase()}`);
    }

    // Atomically claim the card: flip to REDEEMED only if still ACTIVE. This
    // guards against two concurrent redeems of the same code — the second
    // updateMany matches zero rows and we bail before crediting any wallet.
    const claim = await this.prisma.giftCard.updateMany({
      where: { id: card.id, status: 'ACTIVE' },
      data: {
        status: 'REDEEMED',
        balanceMinor: 0,
        redeemedByUserId: userId,
        redeemedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      throw new ConflictException('This gift card has already been redeemed');
    }

    let walletBalanceMinor: number;
    try {
      walletBalanceMinor = await this.wallet.applyDelta({
        userId,
        amountMinor: card.balanceMinor,
        kind: 'CREDIT_GIFT_CARD',
        reason: `Gift card ${card.code} redeemed`,
        currency: card.currency,
      });
    } catch (e) {
      // Roll the claim back so the card can be redeemed again — the wallet
      // credit is the source of truth and it never landed.
      await this.prisma.giftCard.update({
        where: { id: card.id },
        data: {
          status: 'ACTIVE',
          balanceMinor: card.balanceMinor,
          redeemedByUserId: null,
          redeemedAt: null,
        },
      });
      throw e;
    }

    await this.audit
      .record({
        actorUserId: userId,
        action: 'giftcard.redeemed',
        entityType: 'GiftCard',
        entityId: card.id,
        after: { creditedMinor: card.balanceMinor, currency: card.currency },
      })
      .catch(() => undefined);

    return {
      creditedMinor: card.balanceMinor,
      currency: card.currency,
      walletBalanceMinor,
    };
  }

  // ───────────────────────── Listings ─────────────────────────

  async mine(userId: string) {
    const rows = await this.prisma.giftCard.findMany({
      where: { purchaserUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return Promise.all(rows.map((r) => this.toRow(r)));
  }

  // ───────────────────────── Admin ─────────────────────────

  async adminIssue(adminUserId: string, input: AdminIssueInput, meta: ActorMeta) {
    this.validateAmount(input.amountMinor);
    const currency = (input.currency ?? 'USD').toUpperCase();
    let expiresAt: Date | null = null;
    if (input.expiresAt) {
      const d = new Date(input.expiresAt);
      if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        throw new BadRequestException('expiresAt must be a future date');
      }
      expiresAt = d;
    }
    const code = await this.freshCode();
    const card = await this.prisma.giftCard.create({
      data: {
        id: newId(),
        code,
        status: 'ACTIVE',
        currency,
        initialAmountMinor: input.amountMinor,
        balanceMinor: input.amountMinor,
        recipientEmail: input.recipientEmail.toLowerCase(),
        recipientName: input.recipientName ?? null,
        senderName: input.senderName ?? 'Onsective',
        message: input.message ?? null,
        expiresAt,
        issuedByAdminId: adminUserId,
      },
    });
    await this.audit
      .record({
        actorUserId: adminUserId,
        action: 'giftcard.admin_issued',
        entityType: 'GiftCard',
        entityId: card.id,
        after: { amountMinor: input.amountMinor, currency, recipientEmail: card.recipientEmail },
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch(() => undefined);
    await this.deliver(card.id);
    return this.toRow(card);
  }

  async adminVoid(adminUserId: string, id: string, meta: ActorMeta) {
    const card = await this.prisma.giftCard.findUnique({ where: { id } });
    if (!card) throw new NotFoundException('Gift card not found');
    if (card.status === 'REDEEMED') {
      throw new ConflictException('A redeemed gift card cannot be voided');
    }
    if (card.status === 'VOID') return { ok: true as const };
    await this.prisma.giftCard.update({
      where: { id },
      data: { status: 'VOID', balanceMinor: 0 },
    });
    await this.audit
      .record({
        actorUserId: adminUserId,
        action: 'giftcard.admin_voided',
        entityType: 'GiftCard',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch(() => undefined);
    return { ok: true as const };
  }

  async adminList(filters: { status?: GiftCardStatus; q?: string; limit?: number }) {
    const where: Prisma.GiftCardWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.q) {
      const q = filters.q.trim();
      where.OR = [
        { code: { contains: q.toUpperCase() } },
        { recipientEmail: { contains: q.toLowerCase() } },
      ];
    }
    const rows = await this.prisma.giftCard.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, filters.limit ?? 100),
    });
    return Promise.all(rows.map((r) => this.toRow(r)));
  }

  // ───────────────────────── helpers ─────────────────────────

  private async toRow(card: GiftCard) {
    const resolved = await this.withLazyExpiry(card);
    return {
      id: resolved.id,
      code: resolved.code,
      status: resolved.status,
      currency: resolved.currency,
      initialAmountMinor: resolved.initialAmountMinor,
      balanceMinor: resolved.balanceMinor,
      recipientEmail: resolved.recipientEmail,
      recipientName: resolved.recipientName,
      senderName: resolved.senderName,
      message: resolved.message,
      deliverAt: resolved.deliverAt?.toISOString() ?? null,
      deliveredAt: resolved.deliveredAt?.toISOString() ?? null,
      redeemedAt: resolved.redeemedAt?.toISOString() ?? null,
      expiresAt: resolved.expiresAt?.toISOString() ?? null,
      createdAt: resolved.createdAt.toISOString(),
    };
  }
}
