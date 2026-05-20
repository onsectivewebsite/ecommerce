import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Wishlists + 6-hour polling watcher for price drops and back-in-stock signals.
 * We snapshot price + stock per WishlistItem so we can compare against current
 * values without trusting the catalog event stream.
 */
@Injectable()
export class WishlistsService {
  private readonly logger = new Logger(WishlistsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- buyer ----------

  async getDefault(userId: string) {
    let list = await this.prisma.wishlist.findFirst({
      where: { userId, name: 'Default' },
      include: this.itemInclude(),
    });
    if (!list) {
      list = await this.prisma.wishlist.create({
        data: { id: newId(), userId, name: 'Default' },
        include: this.itemInclude(),
      });
    }
    return this.toDto(list);
  }

  async addItem(userId: string, productId: string) {
    const list = await this.ensureDefault(userId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });
    if (!product || product.status !== 'ACTIVE') throw new NotFoundException('Product not available');
    const inStock = product.variants.some((v) => v.inventoryQty > 0);
    try {
      await this.prisma.wishlistItem.create({
        data: {
          id: newId(),
          wishlistId: list.id,
          productId,
          snapshotPriceMinor: product.basePriceMinor,
          snapshotCurrency: product.currency,
          snapshotInStock: inStock,
        },
      });
    } catch (e) {
      // Unique on (wishlistId, productId) — silently ignore.
      this.logger.debug(`wishlist add no-op: ${(e as Error).message}`);
    }
    return this.getDefault(userId);
  }

  async removeItem(userId: string, productId: string) {
    const list = await this.ensureDefault(userId);
    await this.prisma.wishlistItem.deleteMany({ where: { wishlistId: list.id, productId } });
    return this.getDefault(userId);
  }

  async rotateShareToken(userId: string) {
    const list = await this.ensureDefault(userId);
    const token = randomBytes(12).toString('base64url');
    await this.prisma.wishlist.update({ where: { id: list.id }, data: { shareToken: token } });
    return { shareToken: token };
  }

  async clearShareToken(userId: string) {
    const list = await this.ensureDefault(userId);
    await this.prisma.wishlist.update({ where: { id: list.id }, data: { shareToken: null } });
    return { ok: true };
  }

  // ---------- public ----------

  async publicByToken(token: string) {
    const list = await this.prisma.wishlist.findUnique({
      where: { shareToken: token },
      include: this.itemInclude(),
    });
    if (!list) throw new NotFoundException('Wishlist not found');
    // Strip user identity from the public view.
    return {
      items: this.toDto(list).items,
      sharedAt: list.updatedAt.toISOString(),
    };
  }

  // ---------- watcher ----------

  /**
   * Compare current product state against each item's snapshot. Fire a push
   * notification when the buyer's interest is rewarded (price ↓ or back in
   * stock). Update the snapshot afterward so the same drop doesn't double-notify.
   */
  async runWatcher(): Promise<{ scanned: number; notified: number }> {
    const items = await this.prisma.wishlistItem.findMany({
      include: {
        wishlist: { select: { userId: true } },
        product: { include: { variants: { select: { inventoryQty: true } } } },
      },
      take: 5000, // safety cap; in production we'd page.
    });
    let notified = 0;
    for (const item of items) {
      if (!item.product || item.product.status !== 'ACTIVE') continue;
      const currentInStock = item.product.variants.some((v) => v.inventoryQty > 0);
      const currentPrice = item.product.basePriceMinor;
      const priceDropped = currentPrice < item.snapshotPriceMinor;
      const cameBackInStock = currentInStock && !item.snapshotInStock;

      if (priceDropped || cameBackInStock) {
        const title = priceDropped ? 'Price drop on your wishlist' : 'Back in stock';
        const dropPct = priceDropped
          ? Math.round(((item.snapshotPriceMinor - currentPrice) / item.snapshotPriceMinor) * 100)
          : 0;
        const body = priceDropped
          ? `"${item.product.title.slice(0, 60)}" is now ${dropPct}% off.`
          : `"${item.product.title.slice(0, 60)}" is available again.`;
        await this.notifications.sendToUser(item.wishlist.userId, {
          title, body,
          data: { screen: 'Product', productId: item.productId, slug: item.product.slug },
          categoryId: priceDropped ? 'wishlist_price_drop' : 'wishlist_back_in_stock',
        }).catch((e) => this.logger.warn(`wishlist push failed: ${(e as Error).message}`));
        notified++;
      }

      // Snapshot drift: always update so next pass compares to the latest seen value.
      if (priceDropped || cameBackInStock || currentInStock !== item.snapshotInStock || currentPrice !== item.snapshotPriceMinor) {
        await this.prisma.wishlistItem.update({
          where: { id: item.id },
          data: {
            snapshotPriceMinor: currentPrice,
            snapshotInStock: currentInStock,
            lastNotifiedAt: (priceDropped || cameBackInStock) ? new Date() : item.lastNotifiedAt,
          },
        });
      }
    }
    return { scanned: items.length, notified };
  }

  // ---------- helpers ----------

  private itemInclude() {
    return {
      items: {
        orderBy: { createdAt: 'desc' as const },
        include: {
          product: {
            select: {
              id: true, slug: true, title: true, currency: true, basePriceMinor: true, status: true,
              media: { orderBy: { position: 'asc' as const }, take: 1 },
            },
          },
        },
      },
    };
  }

  private async ensureDefault(userId: string) {
    const existing = await this.prisma.wishlist.findFirst({ where: { userId, name: 'Default' } });
    if (existing) return existing;
    return this.prisma.wishlist.create({ data: { id: newId(), userId, name: 'Default' } });
  }

  private toDto(list: any) {
    return {
      id: list.id,
      name: list.name,
      shareToken: list.shareToken ?? null,
      items: (list.items ?? []).map((i: any) => ({
        id: i.id,
        productId: i.productId,
        slug: i.product?.slug ?? '',
        title: i.product?.title ?? '',
        currency: i.product?.currency ?? i.snapshotCurrency,
        currentPriceMinor: i.product?.basePriceMinor ?? i.snapshotPriceMinor,
        snapshotPriceMinor: i.snapshotPriceMinor,
        snapshotInStock: i.snapshotInStock,
        imageUrl: i.product?.media?.[0]?.url ?? null,
        addedAt: i.createdAt.toISOString(),
      })),
    };
  }
}
