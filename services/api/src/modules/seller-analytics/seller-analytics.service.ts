import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import type { ProductEventKind } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Event ingestion + roll-up reads. Writes are intentionally fire-and-forget
 * from the catalog / cart / orders services so analytics outages can never
 * block the buying flow.
 *
 * Reads run direct SQL aggregations; for the typical 30-day window an index
 * on (sellerId, occurredAt) keeps these well under 100ms on 50k events.
 */
@Injectable()
export class SellerAnalyticsService {
  private readonly logger = new Logger(SellerAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------- ingestion ----------

  /** Non-throwing write used from hot paths (catalog detail, cart add, checkout). */
  async record(input: {
    productId: string;
    sellerId: string;
    kind: ProductEventKind;
    variantId?: string;
    userId?: string;
    sessionId?: string;
    orderId?: string;
    amountMinor?: number;
    currency?: string;
  }) {
    try {
      await this.prisma.productEvent.create({
        data: {
          id: newId(),
          productId: input.productId,
          variantId: input.variantId ?? null,
          sellerId: input.sellerId,
          kind: input.kind,
          userId: input.userId ?? null,
          sessionId: input.sessionId ?? null,
          orderId: input.orderId ?? null,
          amountMinor: input.amountMinor ?? 0,
          currency: input.currency ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`event ingest failed (${input.kind} on ${input.productId}): ${(e as Error).message}`);
    }
  }

  // ---------- reads for the seller dashboard ----------

  async sellerOverview(sellerUserId: string, daysBack = 30) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new ForbiddenException('Seller profile required');
    const since = new Date(Date.now() - daysBack * DAY_MS);

    const [funnel, topProducts, aovDaily, returnRate, orderCount] = await Promise.all([
      this.funnelForSeller(seller.id, since),
      this.topProducts(seller.id, since, 10),
      this.aovDailyTrend(seller.id, since),
      this.returnRatePerSku(seller.id, since, 10),
      this.orderCount(seller.id, since),
    ]);

    return {
      windowDays: daysBack,
      orderCount,
      funnel,
      topProducts,
      aovTrend: aovDaily,
      returnRateBySku: returnRate,
    };
  }

  private async funnelForSeller(sellerId: string, since: Date) {
    const rows = await this.prisma.productEvent.groupBy({
      where: { sellerId, occurredAt: { gte: since } },
      by: ['kind'],
      _count: { _all: true },
    });
    const out = { VIEW: 0, ADD_TO_CART: 0, PURCHASE: 0 };
    for (const r of rows) out[r.kind as keyof typeof out] = r._count._all;
    const viewToAdd = out.VIEW > 0 ? out.ADD_TO_CART / out.VIEW : 0;
    const addToPurchase = out.ADD_TO_CART > 0 ? out.PURCHASE / out.ADD_TO_CART : 0;
    const overall = out.VIEW > 0 ? out.PURCHASE / out.VIEW : 0;
    return { ...out, viewToAddRate: viewToAdd, addToPurchaseRate: addToPurchase, overallConversion: overall };
  }

  private async topProducts(sellerId: string, since: Date, limit: number) {
    const rows = await this.prisma.productEvent.groupBy({
      where: { sellerId, kind: 'PURCHASE', occurredAt: { gte: since } },
      by: ['productId'],
      _sum: { amountMinor: true },
      _count: { _all: true },
      orderBy: { _sum: { amountMinor: 'desc' } },
      take: limit,
    });
    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.productId) } },
      select: { id: true, title: true, slug: true, currency: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return rows.map((r) => ({
      productId: r.productId,
      title: byId.get(r.productId)?.title ?? r.productId,
      slug: byId.get(r.productId)?.slug ?? '',
      currency: byId.get(r.productId)?.currency ?? 'USD',
      purchases: r._count._all,
      revenueMinor: r._sum.amountMinor ?? 0,
    }));
  }

  private async aovDailyTrend(sellerId: string, since: Date) {
    // PostgreSQL date_trunc; aggregate per day. Group-by-day in Prisma needs
    // raw SQL — keep portable by aggregating in memory; the dataset is bounded.
    const events = await this.prisma.productEvent.findMany({
      where: { sellerId, kind: 'PURCHASE', occurredAt: { gte: since } },
      select: { occurredAt: true, amountMinor: true, orderId: true },
    });
    const byDay = new Map<string, { dayKey: string; orders: Set<string>; revenue: number }>();
    for (const e of events) {
      const dayKey = e.occurredAt.toISOString().slice(0, 10);
      const bucket = byDay.get(dayKey) ?? { dayKey, orders: new Set(), revenue: 0 };
      if (e.orderId) bucket.orders.add(e.orderId);
      bucket.revenue += e.amountMinor;
      byDay.set(dayKey, bucket);
    }
    return Array.from(byDay.values())
      .map((b) => ({
        date: b.dayKey,
        orders: b.orders.size,
        revenueMinor: b.revenue,
        aovMinor: b.orders.size > 0 ? Math.round(b.revenue / b.orders.size) : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private async returnRatePerSku(sellerId: string, since: Date, limit: number) {
    const purchases = await this.prisma.productEvent.groupBy({
      where: { sellerId, kind: 'PURCHASE', occurredAt: { gte: since } },
      by: ['productId'],
      _count: { _all: true },
      _sum: { amountMinor: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });
    if (purchases.length === 0) return [];
    const productIds = purchases.map((p) => p.productId);
    // Returns by product require joining OrderItem → variant → product. We
    // aggregate in two roundtrips: count returns by variant.productId.
    const returnItems = await this.prisma.returnItem.findMany({
      where: {
        return: { sellerId, createdAt: { gte: since } },
        orderItem: { variant: { productId: { in: productIds } } },
      },
      include: { orderItem: { include: { variant: { select: { productId: true } } } } },
    });
    const returnCount = new Map<string, number>();
    for (const ri of returnItems) {
      const pid = ri.orderItem.variant.productId;
      returnCount.set(pid, (returnCount.get(pid) ?? 0) + ri.quantity);
    }
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, title: true, slug: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return purchases.map((p) => {
      const purchasedUnits = p._count._all;
      const returned = returnCount.get(p.productId) ?? 0;
      return {
        productId: p.productId,
        title: byId.get(p.productId)?.title ?? p.productId,
        slug: byId.get(p.productId)?.slug ?? '',
        purchases: purchasedUnits,
        returns: returned,
        returnRate: purchasedUnits > 0 ? returned / purchasedUnits : 0,
      };
    });
  }

  private async orderCount(sellerId: string, since: Date): Promise<number> {
    return this.prisma.order.count({ where: { sellerId, createdAt: { gte: since } } });
  }
}
