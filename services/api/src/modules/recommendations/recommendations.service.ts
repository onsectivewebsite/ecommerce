import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CurrencyCode,
  ProductStatus,
  ProductSummaryDto,
} from '@onsective/shared-types';

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Frequently bought together — pulls top N co-purchased products from `ProductCoView`.
   * The table is canonicalized (aId < bId), so we look on either side and pick the
   * neighbour. Hot products with hundreds of co-views per partner return in a few ms.
   */
  async fbt(productId: string, limit = 4): Promise<ProductSummaryDto[]> {
    const rows = await this.prisma.productCoView.findMany({
      where: { OR: [{ aId: productId }, { bId: productId }] },
      orderBy: { count: 'desc' },
      take: limit * 3, // overfetch — we drop archived / out-of-stock below.
    });
    const partnerIds = rows
      .map((r) => (r.aId === productId ? r.bId : r.aId))
      .filter((id) => id !== productId);
    if (partnerIds.length === 0) return [];
    const products = await this.loadProducts(partnerIds);
    // Preserve the co-view ordering after the dedup/filter.
    return rankBy(partnerIds, products).slice(0, limit);
  }

  /**
   * Similar PDPs — same category, similar base price band, light seller-diversity boost.
   * Pure SQL: no co-view needed. Works for brand-new products that have zero co-purchases.
   */
  async similar(productId: string, limit = 8): Promise<ProductSummaryDto[]> {
    const root = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, categoryId: true, sellerId: true, basePriceMinor: true, currency: true },
    });
    if (!root) return [];
    const band = Math.max(500, Math.round(root.basePriceMinor * 0.6));
    const candidates = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        categoryId: root.categoryId,
        currency: root.currency,
        id: { not: root.id },
        basePriceMinor: { gte: Math.max(0, root.basePriceMinor - band), lte: root.basePriceMinor + band },
      },
      include: { media: { orderBy: { position: 'asc' }, take: 1 }, seller: true, category: true },
      orderBy: { createdAt: 'desc' },
      take: limit * 4,
    });

    // Sort: same-seller items 30% boost; closer price wins ties.
    const scored = candidates.map((p) => {
      const sellerBoost = p.sellerId === root.sellerId ? 0.7 : 1.0;
      const priceDelta = Math.abs(p.basePriceMinor - root.basePriceMinor);
      return { p, score: priceDelta * sellerBoost };
    }).sort((a, b) => a.score - b.score);

    // Diversify: cap any single seller at 2 items in the final set.
    const out: ProductSummaryDto[] = [];
    const perSeller = new Map<string, number>();
    for (const { p } of scored) {
      const n = perSeller.get(p.sellerId) ?? 0;
      if (n >= 2) continue;
      perSeller.set(p.sellerId, n + 1);
      out.push(toSummary(p));
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * "For you" — categories the user has purchased from, weighted by recency.
   * No interaction history → falls back to the latest 12 active products overall.
   */
  async forYou(userId: string | null, limit = 12): Promise<ProductSummaryDto[]> {
    if (!userId) return this.latestActive(limit);
    const orders = await this.prisma.order.findMany({
      where: { userId, status: { in: ['PAID', 'FULFILLING', 'SHIPPED', 'DELIVERED'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { items: { include: { variant: { include: { product: true } } } } },
    });
    const weights = new Map<string, number>(); // categoryId -> weight
    for (const o of orders) {
      const ageDays = Math.max(1, (Date.now() - o.createdAt.getTime()) / 86400_000);
      const w = 1 / Math.log2(2 + ageDays);
      for (const it of o.items) {
        const cid = it.variant.product.categoryId;
        weights.set(cid, (weights.get(cid) ?? 0) + w);
      }
    }
    if (weights.size === 0) return this.latestActive(limit);
    const topCats = Array.from(weights.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map((e) => e[0]);
    const rows = await this.prisma.product.findMany({
      where: { status: 'ACTIVE', categoryId: { in: topCats } },
      include: { media: { orderBy: { position: 'asc' }, take: 1 }, seller: true, category: true },
      orderBy: { createdAt: 'desc' },
      take: limit * 2,
    });
    // Interleave categories so the rail isn't monoculture.
    const byCat = new Map<string, any[]>();
    for (const p of rows) {
      const arr = byCat.get(p.categoryId) ?? [];
      arr.push(p);
      byCat.set(p.categoryId, arr);
    }
    const order: any[] = [];
    let added = true;
    while (order.length < limit && added) {
      added = false;
      for (const cid of topCats) {
        const arr = byCat.get(cid);
        if (arr && arr.length > 0) {
          order.push(arr.shift());
          added = true;
          if (order.length >= limit) break;
        }
      }
    }
    return order.map(toSummary);
  }

  private async loadProducts(ids: string[]) {
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      include: { media: { orderBy: { position: 'asc' }, take: 1 }, seller: true, category: true },
    });
    return rows;
  }

  private async latestActive(limit: number) {
    const rows = await this.prisma.product.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { media: { orderBy: { position: 'asc' }, take: 1 }, seller: true, category: true },
    });
    return rows.map(toSummary);
  }
}

function toSummary(p: any): ProductSummaryDto {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    currency: p.currency as CurrencyCode,
    basePriceMinor: p.basePriceMinor,
    media: (p.media ?? []).map((m: any) => ({ id: m.id, url: m.url, alt: m.alt ?? null, position: m.position })),
    sellerName: p.seller.displayName,
    categorySlug: p.category.slug,
    status: p.status as ProductStatus,
  };
}

function rankBy(orderedIds: string[], products: any[]): ProductSummaryDto[] {
  const byId = new Map<string, any>(products.map((p) => [p.id, p]));
  const out: ProductSummaryDto[] = [];
  for (const id of orderedIds) {
    const p = byId.get(id);
    if (p) out.push(toSummary(p));
  }
  return out;
}
