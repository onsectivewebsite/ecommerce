import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { newId } from '../../common/id';

export interface ListingFeeRuleInput {
  sellerId?: string | null;
  categoryId?: string | null;
  amountMinor: number;
  currency?: string;
  enabled?: boolean;
  note?: string;
}

@Injectable()
export class ListingFeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Resolve the best rule for a product: seller+category > seller > category > platform default. */
  async resolveRule(sellerId: string, categoryId: string) {
    const candidates = await this.prisma.listingFeeRule.findMany({
      where: {
        enabled: true,
        OR: [
          { sellerId, categoryId },
          { sellerId, categoryId: null },
          { sellerId: null, categoryId },
          { sellerId: null, categoryId: null },
        ],
      },
    });
    if (candidates.length === 0) return null;
    const score = (r: { sellerId: string | null; categoryId: string | null }) =>
      (r.sellerId ? 2 : 0) + (r.categoryId ? 1 : 0);
    candidates.sort((a, b) => score(b) - score(a));
    return candidates[0] ?? null;
  }

  /** Charge the resolved rule against the product. Idempotent: returns existing charge if already billed. */
  async chargeOnPublish(sellerId: string, productId: string, categoryId: string) {
    const already = await this.prisma.listingFeeCharge.findFirst({ where: { productId } });
    if (already) return already;
    const rule = await this.resolveRule(sellerId, categoryId);
    if (!rule || rule.amountMinor === 0) {
      return this.prisma.listingFeeCharge.create({
        data: {
          id: newId(),
          sellerId,
          productId,
          ruleId: rule?.id ?? null,
          amountMinor: 0,
          currency: rule?.currency ?? 'USD',
          note: rule ? 'Rule resolved at amount 0' : 'No rule matched — defaulted to 0',
        },
      });
    }
    return this.prisma.listingFeeCharge.create({
      data: {
        id: newId(),
        sellerId,
        productId,
        ruleId: rule.id,
        amountMinor: rule.amountMinor,
        currency: rule.currency,
        note: rule.note ?? undefined,
      },
    });
  }

  // ---- admin CRUD ----

  async list(filter?: { sellerId?: string }) {
    return this.prisma.listingFeeRule.findMany({
      where: filter?.sellerId ? { sellerId: filter.sellerId } : undefined,
      orderBy: [{ sellerId: 'asc' }, { categoryId: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async listCharges(filter: { sellerId?: string; productId?: string; limit?: number }) {
    return this.prisma.listingFeeCharge.findMany({
      where: { sellerId: filter.sellerId, productId: filter.productId },
      orderBy: { chargedAt: 'desc' },
      take: Math.min(500, filter.limit ?? 200),
    });
  }

  async create(input: ListingFeeRuleInput, actor: { userId: string; ip?: string; userAgent?: string }) {
    const row = await this.prisma.listingFeeRule.create({
      data: {
        id: newId(),
        sellerId: input.sellerId ?? null,
        categoryId: input.categoryId ?? null,
        amountMinor: input.amountMinor,
        currency: input.currency ?? 'USD',
        enabled: input.enabled ?? true,
        note: input.note,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'listing_fee.create',
      entityType: 'ListingFeeRule',
      entityId: row.id,
      after: row,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return row;
  }

  async update(id: string, patch: Partial<ListingFeeRuleInput>, actor: { userId: string; ip?: string; userAgent?: string }) {
    const before = await this.prisma.listingFeeRule.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Rule not found');
    const row = await this.prisma.listingFeeRule.update({
      where: { id },
      data: {
        sellerId: patch.sellerId === undefined ? before.sellerId : patch.sellerId,
        categoryId: patch.categoryId === undefined ? before.categoryId : patch.categoryId,
        amountMinor: patch.amountMinor ?? before.amountMinor,
        currency: patch.currency ?? before.currency,
        enabled: patch.enabled ?? before.enabled,
        note: patch.note ?? before.note,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'listing_fee.update',
      entityType: 'ListingFeeRule',
      entityId: row.id,
      before,
      after: row,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return row;
  }

  async remove(id: string, actor: { userId: string; ip?: string; userAgent?: string }) {
    const before = await this.prisma.listingFeeRule.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Rule not found');
    await this.prisma.listingFeeRule.delete({ where: { id } });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'listing_fee.delete',
      entityType: 'ListingFeeRule',
      entityId: id,
      before,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { ok: true };
  }
}
