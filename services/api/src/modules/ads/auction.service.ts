import { Injectable, Logger } from '@nestjs/common';
import type { AdPlacementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuctionContext {
  searchKeyword?: string;
  categorySlug?: string;
  excludeCampaignIds?: string[];
}

export interface ResolvedAd {
  campaignId: string;
  placementId: string;
  type: AdPlacementType;
  productId: string | null;
  destinationUrl: string | null;
  sellerId: string;
  sellerName?: string;
  product?: {
    id: string;
    slug: string;
    title: string;
    basePriceMinor: number;
    currency: string;
    imageUrl: string | null;
  } | null;
}

/**
 * Phase 4 auction — request-time scoring.
 *   score = campaign.bidMinor * placement.weight * campaign.priority
 * Filters out:
 *   - campaigns not ACTIVE / outside [startsAt, endsAt]
 *   - campaigns whose totalBudget or dailyBudget is exhausted
 */
@Injectable()
export class AuctionService {
  private readonly logger = new Logger(AuctionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(type: AdPlacementType, ctx: AuctionContext = {}): Promise<ResolvedAd | null> {
    const now = new Date();
    const where: any = {
      type,
      campaign: {
        status: 'ACTIVE',
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null },   { endsAt:   { gte: now } }] },
        ],
      },
    };
    if (ctx.searchKeyword) {
      where.OR = [
        { searchKeyword: null },
        { searchKeyword: { equals: ctx.searchKeyword.toLowerCase() } },
      ];
    }
    if (ctx.categorySlug) {
      where.AND = [{ OR: [{ categorySlug: null }, { categorySlug: ctx.categorySlug }] }];
    }
    if (ctx.excludeCampaignIds?.length) {
      where.campaignId = { notIn: ctx.excludeCampaignIds };
    }

    const candidates = await this.prisma.adPlacement.findMany({
      where,
      include: {
        campaign: { include: { seller: true } },
        product: { include: { media: { orderBy: { position: 'asc' }, take: 1 } } },
      },
      take: 50,
    });
    if (!candidates.length) return null;

    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    // Compute today's spend per candidate campaign (needed for dailyBudget cap).
    const campaignIds = Array.from(new Set(candidates.map((c) => c.campaignId)));
    const todaySpend = await this.prisma.adEvent.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds }, occurredAt: { gte: start } },
      _sum: { amountMinor: true },
    });
    const todayMap = new Map(todaySpend.map((r) => [r.campaignId, r._sum.amountMinor ?? 0]));

    const scored = candidates
      .map((p) => ({ p, score: this.score(p, todayMap.get(p.campaignId) ?? 0) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best) return null;

    const c = best.p;
    const product = c.product
      ? {
          id: c.product.id,
          slug: c.product.slug,
          title: c.product.title,
          basePriceMinor: c.product.basePriceMinor,
          currency: c.product.currency,
          imageUrl: c.product.media?.[0]?.url ?? null,
        }
      : null;
    return {
      campaignId: c.campaignId,
      placementId: c.id,
      type: c.type,
      productId: c.productId,
      destinationUrl: c.destinationUrl ?? (c.product ? `/p/${c.product.slug}` : null),
      sellerId: c.campaign.sellerId,
      sellerName: c.campaign.seller?.displayName,
      product,
    };
  }

  private score(p: any, todaySpentMinor: number): number {
    const c = p.campaign;
    if (c.totalBudgetMinor > 0 && c.spentMinor >= c.totalBudgetMinor) return 0;
    if (c.dailyBudgetMinor > 0 && todaySpentMinor >= c.dailyBudgetMinor) return 0;
    if (c.bidMinor <= 0) return 0;
    return c.bidMinor * Math.max(1, p.weight) * Math.max(1, c.priority);
  }
}
