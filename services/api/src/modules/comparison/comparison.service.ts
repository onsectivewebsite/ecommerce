import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';

/** A comparison table wider than this stops being scannable. */
const MAX_COMPARISON_ITEMS = 4;

@Injectable()
export class ComparisonService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const items = await this.prisma.comparisonItem.findMany({
      where: { userId, product: { status: 'ACTIVE' } },
      orderBy: { createdAt: 'asc' },
      include: {
        product: {
          include: {
            media: { orderBy: { position: 'asc' }, take: 1 },
            brand: { select: { name: true } },
            seller: { select: { storeName: true } },
            category: { select: { name: true } },
            variants: { select: { priceMinor: true, inventoryQty: true } },
          },
        },
      },
    });

    const productIds = items.map((i) => i.productId);
    const ratings = productIds.length
      ? await this.prisma.review.groupBy({
          by: ['productId'],
          where: { productId: { in: productIds }, status: 'VISIBLE' },
          _avg: { rating: true },
          _count: { _all: true },
        })
      : [];
    const ratingMap = new Map(
      ratings.map((r) => [r.productId, { avg: r._avg.rating ?? 0, count: r._count._all }]),
    );

    return items.map((i) => {
      const p = i.product;
      const prices = p.variants.map((v) => v.priceMinor);
      const priceMinor = prices.length ? Math.min(...prices) : p.basePriceMinor;
      const inStock = p.variants.some((v) => v.inventoryQty > 0);
      const r = ratingMap.get(p.id);
      return {
        productId: p.id,
        slug: p.slug,
        title: p.title,
        imageUrl: p.media[0]?.url ?? null,
        currency: p.currency,
        priceMinor,
        condition: p.condition,
        brandName: p.brand?.name ?? null,
        sellerName: p.seller.storeName,
        categoryName: p.category.name,
        inStock,
        ratingAvg: r ? Math.round(r.avg * 100) / 100 : 0,
        ratingCount: r ? r.count : 0,
        attributes: (p.attributes ?? {}) as Record<string, unknown>,
        addedAt: i.createdAt.toISOString(),
      };
    });
  }

  async add(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.status !== 'ACTIVE') throw new NotFoundException('Product not found');

    const existing = await this.prisma.comparisonItem.findUnique({
      where: { userId_productId: { userId, productId } },
    });
    if (!existing) {
      const count = await this.prisma.comparisonItem.count({ where: { userId } });
      if (count >= MAX_COMPARISON_ITEMS) {
        throw new BadRequestException(`You can compare up to ${MAX_COMPARISON_ITEMS} products at a time`);
      }
      await this.prisma.comparisonItem.create({
        data: { id: newId(), userId, productId },
      });
    }
    return this.list(userId);
  }

  async remove(userId: string, productId: string) {
    await this.prisma.comparisonItem.deleteMany({ where: { userId, productId } });
    return this.list(userId);
  }

  async clear(userId: string) {
    await this.prisma.comparisonItem.deleteMany({ where: { userId } });
    return { ok: true };
  }
}
