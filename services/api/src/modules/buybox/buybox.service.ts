import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Listings-refactor Step 2: returns the single ProductListing that should
 * receive the PDP's "Add to cart" CTA.
 *
 * Today (one listing per product, by backfill construction) the winner is
 * trivially the sole ACTIVE listing. Once Step 4 lets a second seller list
 * on the same product, this method gains the real ranking from
 * [[doc/listings-refactor.md#step-5]] — price/fulfillment/seller-health/
 * stock/delivery — without changing the API surface or PDP integration.
 */
@Injectable()
export class BuyBoxService {
  constructor(private readonly prisma: PrismaService) {}

  async winnerFor(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true, slug: true, basePriceMinor: true, currency: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.status !== 'ACTIVE') {
      return { productId, winner: null as null };
    }

    const winner = await this.prisma.productListing.findFirst({
      where: { productId, status: 'ACTIVE' },
      orderBy: [{ buyBoxScore: 'desc' }, { createdAt: 'asc' }],
      include: { seller: { select: { id: true, displayName: true, storeName: true } } },
    });

    if (!winner) {
      // No listing yet — fall back signal so the PDP can still render the
      // legacy product price path while Step 3 is in flight.
      return { productId, winner: null as null };
    }

    return {
      productId,
      winner: {
        listingId: winner.id,
        sellerId: winner.sellerId,
        sellerName: winner.seller.displayName,
        sellerStoreSlug: winner.seller.storeName,
        priceMinor: winner.priceMinor,
        currency: winner.currency,
        condition: winner.condition,
        fulfillmentMode: winner.fulfillmentMode,
        isOnsectiveFulfilled: winner.fulfillmentMode === 'PLATFORM',
      },
    };
  }
}
