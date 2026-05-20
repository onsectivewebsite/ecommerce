import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type Range = '7d' | '30d' | '90d';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private since(range: Range): Date {
    const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  private async sellerIdFor(userId: string): Promise<string> {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('No seller profile');
    return seller.id;
  }

  async summary(userId: string, range: Range) {
    const sellerId = await this.sellerIdFor(userId);
    const since = this.since(range);
    const orders = await this.prisma.order.findMany({
      where: { sellerId, createdAt: { gte: since } },
      select: {
        id: true,
        status: true,
        totalMinor: true,
        subtotalMinor: true,
        commissionMinor: true,
        currency: true,
        createdAt: true,
      },
    });
    const paid = orders.filter((o) => ['PAID', 'FULFILLING', 'SHIPPED', 'DELIVERED'].includes(o.status));
    const refunded = orders.filter((o) => o.status === 'REFUNDED').length;
    const grossMinor = paid.reduce((s, o) => s + o.totalMinor, 0);
    const netSellerMinor = paid.reduce((s, o) => s + (o.subtotalMinor - o.commissionMinor), 0);
    const commissionMinor = paid.reduce((s, o) => s + o.commissionMinor, 0);
    const orderCount = paid.length;
    const aovMinor = orderCount === 0 ? 0 : Math.round(grossMinor / orderCount);
    return {
      range,
      since: since.toISOString(),
      currency: paid[0]?.currency ?? 'USD',
      orderCount,
      grossMinor,
      netSellerMinor,
      commissionMinor,
      aovMinor,
      refundedCount: refunded,
    };
  }

  async topSkus(userId: string, range: Range, limit = 10) {
    const sellerId = await this.sellerIdFor(userId);
    const since = this.since(range);
    const rows = await this.prisma.orderItem.groupBy({
      by: ['variantId'],
      where: {
        order: {
          sellerId,
          createdAt: { gte: since },
          status: { in: ['PAID', 'FULFILLING', 'SHIPPED', 'DELIVERED'] },
        },
      },
      _sum: { qty: true, lineSubtotalMinor: true },
      orderBy: { _sum: { lineSubtotalMinor: 'desc' } },
      take: limit,
    });
    const variantIds = rows.map((r) => r.variantId);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: true },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    return rows.map((r) => {
      const v = byId.get(r.variantId);
      return {
        variantId: r.variantId,
        sku: v?.sku ?? '',
        productTitle: v?.product?.title ?? '',
        variantName: v?.name ?? '',
        unitsSold: r._sum.qty ?? 0,
        revenueMinor: r._sum.lineSubtotalMinor ?? 0,
      };
    });
  }
}
