import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import type {
  Promotion,
  PromotionKind,
  PromotionScope,
} from '@prisma/client';
import type { CreatePromotionDto, UpdatePromotionDto } from './dto';

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

/** Line item shape we evaluate against — keep it cart/order-agnostic. */
export interface PricingLine {
  productId: string;
  sellerId: string;
  qty: number;
  unitPriceMinor: number;
  lineSubtotalMinor: number;
}

export interface DiscountLine {
  code: string;
  promotionId: string;
  scope: PromotionScope;
  kind: PromotionKind;
  amountMinor: number;
  reason: string;
}

export interface PromotionEvaluation {
  discountLines: DiscountLine[];
  totalDiscountMinor: number;
  freeShipping: boolean;
}

/**
 * Promotions engine. Sellers + admins manage codes; checkout evaluates the
 * codes against a pricing context and returns per-code discount lines.
 * Discounts are NOT persisted on the cart — recomputed on each preview so a
 * stale value cannot accidentally undercut the seller during a price change.
 *
 * Stacking: at most one SELLER code + at most one PLATFORM code per cart.
 */
@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- seller / admin CRUD ----------

  async createForSeller(sellerUserId: string, dto: CreatePromotionDto, actor: ActorMeta) {
    if (dto.scope !== 'SELLER') throw new ForbiddenException('Sellers can only create SELLER-scope promotions');
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new ForbiddenException('Seller profile required');
    return this.createInternal({ ...dto, sellerId: seller.id }, actor);
  }

  async createForAdmin(dto: CreatePromotionDto, actor: ActorMeta) {
    if (dto.scope === 'SELLER' && !dto.notes?.includes('seller=')) {
      throw new BadRequestException('Admin-created SELLER promotions need a "seller=<id>" hint in notes');
    }
    return this.createInternal(dto, actor);
  }

  private async createInternal(
    dto: CreatePromotionDto & { sellerId?: string },
    actor: ActorMeta,
  ) {
    if (dto.kind === 'BOGO' && (!dto.bogoBuyQty || !dto.bogoGetQty || dto.bogoGetDiscountBp === undefined)) {
      throw new BadRequestException('BOGO promotions require bogoBuyQty, bogoGetQty, bogoGetDiscountBp');
    }
    const existing = await this.prisma.promotion.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Code already in use');

    const promo = await this.prisma.promotion.create({
      data: {
        id: newId(),
        code: dto.code.toUpperCase(),
        kind: dto.kind,
        scope: dto.scope,
        sellerId: dto.sellerId ?? null,
        valueBpOrMinor: dto.valueBpOrMinor,
        currency: dto.currency ?? null,
        minSubtotalMinor: dto.minSubtotalMinor ?? 0,
        bogoBuyQty: dto.bogoBuyQty ?? null,
        bogoGetQty: dto.bogoGetQty ?? null,
        bogoGetDiscountBp: dto.bogoGetDiscountBp ?? null,
        perUserLimit: dto.perUserLimit ?? null,
        totalLimit: dto.totalLimit ?? null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        notes: dto.notes ?? null,
        scopes: dto.productIds && dto.productIds.length > 0 ? {
          create: dto.productIds.map((pid) => ({ productId: pid })),
        } : undefined,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'promotion.create', entityType: 'Promotion', entityId: promo.id,
      after: { code: promo.code, kind: promo.kind, scope: promo.scope },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return promo;
  }

  async update(id: string, sellerUserId: string | null, dto: UpdatePromotionDto, actor: ActorMeta) {
    const promo = await this.prisma.promotion.findUnique({ where: { id } });
    if (!promo) throw new NotFoundException('Promotion not found');
    if (sellerUserId) {
      const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
      if (!seller || promo.sellerId !== seller.id) throw new ForbiddenException('Not your promotion');
    }
    const updated = await this.prisma.promotion.update({
      where: { id },
      data: {
        status: dto.status ?? undefined,
        valueBpOrMinor: dto.valueBpOrMinor ?? undefined,
        minSubtotalMinor: dto.minSubtotalMinor ?? undefined,
        perUserLimit: dto.perUserLimit ?? undefined,
        totalLimit: dto.totalLimit ?? undefined,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        notes: dto.notes ?? undefined,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'promotion.update', entityType: 'Promotion', entityId: id,
      before: promo, after: updated,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  async listForSeller(sellerUserId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) return [];
    return this.prisma.promotion.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
      include: { scopes: true, _count: { select: { redemptions: true } } },
    });
  }

  async listForAdmin(scope?: PromotionScope) {
    return this.prisma.promotion.findMany({
      where: scope ? { scope } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { scopes: true, _count: { select: { redemptions: true } } },
      take: 200,
    });
  }

  // ---------- evaluation ----------

  /**
   * Evaluate the supplied codes against a pricing context. Skips invalid /
   * inapplicable codes silently (caller decides whether to surface a warning).
   */
  async evaluate(
    userId: string | null,
    codes: string[],
    ctx: { subtotalMinor: number; currency: string; lines: PricingLine[] },
  ): Promise<PromotionEvaluation> {
    if (codes.length === 0) {
      return { discountLines: [], totalDiscountMinor: 0, freeShipping: false };
    }
    const normalized = Array.from(new Set(codes.map((c) => c.trim().toUpperCase()))).filter(Boolean);
    const promos = await this.prisma.promotion.findMany({
      where: { code: { in: normalized }, status: 'ACTIVE' },
      include: { scopes: { select: { productId: true } } },
    });

    let sellerPromo: Promotion & { scopes: Array<{ productId: string }> } | null = null;
    let platformPromo: Promotion & { scopes: Array<{ productId: string }> } | null = null;
    for (const p of promos) {
      if (p.scope === 'SELLER' && !sellerPromo) sellerPromo = p;
      if (p.scope === 'PLATFORM' && !platformPromo) platformPromo = p;
    }

    const out: DiscountLine[] = [];
    let freeShipping = false;
    const now = new Date();
    for (const promo of [sellerPromo, platformPromo].filter(Boolean) as Array<Promotion & { scopes: Array<{ productId: string }> }>) {
      // Time window
      if (promo.startsAt && promo.startsAt > now) continue;
      if (promo.endsAt && promo.endsAt < now) continue;
      // Currency
      if (promo.currency && promo.currency !== ctx.currency) continue;
      // Min subtotal
      if (ctx.subtotalMinor < promo.minSubtotalMinor) continue;
      // Scope restrictions: at least one line must match an in-scope product.
      const scopedLines = promo.scopes.length > 0
        ? ctx.lines.filter((l) => promo.scopes.some((s) => s.productId === l.productId))
        : ctx.lines;
      if (scopedLines.length === 0) continue;
      // Seller-scope must match the order's seller.
      if (promo.scope === 'SELLER' && promo.sellerId) {
        const sellerMatches = scopedLines.some((l) => l.sellerId === promo.sellerId);
        if (!sellerMatches) continue;
      }
      // Total redemption cap
      if (promo.totalLimit) {
        const total = await this.prisma.promotionRedemption.count({ where: { promotionId: promo.id } });
        if (total >= promo.totalLimit) continue;
      }
      // Per-user cap
      if (promo.perUserLimit && userId) {
        const used = await this.prisma.promotionRedemption.count({
          where: { promotionId: promo.id, userId },
        });
        if (used >= promo.perUserLimit) continue;
      }

      const scopedSubtotal = scopedLines.reduce((s, l) => s + l.lineSubtotalMinor, 0);
      let amountMinor = 0;
      let reason = '';
      switch (promo.kind) {
        case 'PERCENT_OFF': {
          amountMinor = Math.round((scopedSubtotal * promo.valueBpOrMinor) / 10000);
          reason = `${(promo.valueBpOrMinor / 100).toFixed(2)}% off ${promo.scope === 'SELLER' ? 'seller items' : 'order'}`;
          break;
        }
        case 'AMOUNT_OFF': {
          amountMinor = Math.min(promo.valueBpOrMinor, scopedSubtotal);
          reason = `Flat discount`;
          break;
        }
        case 'FREE_SHIPPING': {
          freeShipping = true;
          amountMinor = 0;
          reason = `Free shipping`;
          break;
        }
        case 'BOGO': {
          // Aggregate scoped qty across all matching products. For each
          // (bogoBuyQty + bogoGetQty) bundle, discount bogoGetQty units at
          // bogoGetDiscountBp of the average scoped unit price.
          const totalQty = scopedLines.reduce((s, l) => s + l.qty, 0);
          const avgUnitMinor = totalQty > 0 ? Math.floor(scopedSubtotal / totalQty) : 0;
          const bundleSize = (promo.bogoBuyQty ?? 1) + (promo.bogoGetQty ?? 1);
          const bundles = Math.floor(totalQty / bundleSize);
          const discountedUnits = bundles * (promo.bogoGetQty ?? 0);
          amountMinor = Math.round((discountedUnits * avgUnitMinor * (promo.bogoGetDiscountBp ?? 0)) / 10000);
          reason = `Buy ${promo.bogoBuyQty} get ${promo.bogoGetQty} at ${((promo.bogoGetDiscountBp ?? 0) / 100).toFixed(0)}% off`;
          break;
        }
      }
      if (amountMinor > 0 || promo.kind === 'FREE_SHIPPING') {
        out.push({
          code: promo.code,
          promotionId: promo.id,
          scope: promo.scope,
          kind: promo.kind,
          amountMinor,
          reason,
        });
      }
    }

    const totalDiscountMinor = out.reduce((s, l) => s + l.amountMinor, 0);
    return { discountLines: out, totalDiscountMinor, freeShipping };
  }

  /**
   * Persist redemption records once the order is committed. Best-effort — the
   * promotionLines snapshot on Order is the source of truth for accounting;
   * these rows exist to support per-user caps and lifetime caps.
   */
  async recordRedemptions(orderId: string, userId: string, lines: DiscountLine[]) {
    if (lines.length === 0) return;
    await Promise.all(lines.map(async (l) => {
      try {
        await this.prisma.promotionRedemption.create({
          data: {
            id: newId(),
            promotionId: l.promotionId,
            userId,
            orderId,
            amountMinor: l.amountMinor,
          },
        });
      } catch (e) {
        // Unique on (promotionId, orderId) — re-run idempotency.
        this.logger.warn(`redemption insert skipped for ${l.promotionId}/${orderId}: ${(e as Error).message}`);
      }
    }));
  }
}
