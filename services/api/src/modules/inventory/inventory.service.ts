import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';

const RESERVATION_TTL_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Effective stock visible to the buyer: raw qty minus the sum of unexpired,
   * un-released reservations for that variant *not* held by this same cart.
   */
  async effectiveQty(variantId: string, excludingCartId?: string): Promise<number> {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) return 0;
    const now = new Date();
    const reserved = await this.prisma.inventoryReservation.aggregate({
      where: {
        variantId,
        releasedAt: null,
        expiresAt: { gt: now },
        ...(excludingCartId ? { cartId: { not: excludingCartId } } : {}),
      },
      _sum: { qty: true },
    });
    return variant.inventoryQty - (reserved._sum.qty ?? 0);
  }

  /**
   * Upsert a reservation for (cart, variant). Throws if not enough stock.
   * Returns the new reservation row.
   */
  async reserve(cartId: string, variantId: string, qty: number) {
    if (qty <= 0) throw new BadRequestException('qty must be > 0');
    return this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
      if (!variant) throw new BadRequestException('Variant not found');
      const now = new Date();
      const heldByOthers = await tx.inventoryReservation.aggregate({
        where: {
          variantId,
          releasedAt: null,
          expiresAt: { gt: now },
          cartId: { not: cartId },
        },
        _sum: { qty: true },
      });
      const free = variant.inventoryQty - (heldByOthers._sum.qty ?? 0);
      if (free < qty) {
        throw new BadRequestException(`Only ${free} available`);
      }
      const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
      const existing = await tx.inventoryReservation.findUnique({
        where: { cartId_variantId: { cartId, variantId } },
      });
      if (existing) {
        return tx.inventoryReservation.update({
          where: { id: existing.id },
          data: { qty, expiresAt, releasedAt: null },
        });
      }
      return tx.inventoryReservation.create({
        data: { id: newId(), cartId, variantId, qty, expiresAt },
      });
    });
  }

  async release(cartId: string, variantId: string): Promise<void> {
    await this.prisma.inventoryReservation.updateMany({
      where: { cartId, variantId, releasedAt: null },
      data: { releasedAt: new Date() },
    });
  }

  async releaseCart(cartId: string): Promise<void> {
    await this.prisma.inventoryReservation.updateMany({
      where: { cartId, releasedAt: null },
      data: { releasedAt: new Date() },
    });
  }

  /** Sweep reservations whose TTL has passed. Returns row count. */
  async sweepExpired(): Promise<number> {
    const res = await this.prisma.inventoryReservation.updateMany({
      where: { releasedAt: null, expiresAt: { lt: new Date() } },
      data: { releasedAt: new Date() },
    });
    if (res.count > 0) this.logger.log(`Released ${res.count} expired reservations`);
    return res.count;
  }
}
