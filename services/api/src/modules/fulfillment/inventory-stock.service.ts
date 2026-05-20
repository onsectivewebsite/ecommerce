import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';

/**
 * Per-warehouse stock writes. Every delta runs inside a Prisma transaction
 * that (a) updates the InventoryStock row and (b) recomputes the
 * ProductVariant.inventoryQty rollup. PDP, search, and the existing cart
 * reservation system continue to read inventoryQty as before.
 *
 * Reservations layer on top: callers pass `warehouseId` so a buyer's cart
 * locks qty on the specific routed warehouse, not the global pool.
 */
@Injectable()
export class InventoryStockService {
  private readonly logger = new Logger(InventoryStockService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------- writes ----------

  /** Apply a signed delta (positive = receive, negative = ship). Returns
   *  the new on-hand at the warehouse + the recomputed rollup. */
  async applyDelta(input: { variantId: string; warehouseId: string; delta: number }) {
    if (input.delta === 0) return null;
    return this.prisma.$transaction(async (tx) => {
      // Upsert the stock row.
      let stock = await tx.inventoryStock.findUnique({
        where: { variantId_warehouseId: { variantId: input.variantId, warehouseId: input.warehouseId } },
      });
      if (!stock) {
        if (input.delta < 0) throw new BadRequestException('No stock at this warehouse to debit');
        stock = await tx.inventoryStock.create({
          data: { id: newId(), variantId: input.variantId, warehouseId: input.warehouseId, quantityOnHand: 0 },
        });
      }
      const nextQty = stock.quantityOnHand + input.delta;
      if (nextQty < 0) throw new BadRequestException(`Insufficient stock at warehouse (have ${stock.quantityOnHand}, need ${-input.delta})`);
      const updated = await tx.inventoryStock.update({
        where: { id: stock.id }, data: { quantityOnHand: nextQty },
      });
      // Recompute rollup over ALL stocks for this variant (including the one
      // we just updated — the read sees the new value because we're inside the
      // same transaction).
      const agg = await tx.inventoryStock.aggregate({
        where: { variantId: input.variantId },
        _sum: { quantityOnHand: true },
      });
      const rollup = agg._sum.quantityOnHand ?? 0;
      await tx.productVariant.update({
        where: { id: input.variantId },
        data: { inventoryQty: rollup },
      });
      return { warehouseQty: updated.quantityOnHand, rollupQty: rollup };
    });
  }

  /** Receive an inbound shipment line. Convenience wrapper around applyDelta. */
  async receiveInbound(variantId: string, warehouseId: string, qty: number) {
    if (qty <= 0) throw new BadRequestException('qty must be > 0');
    return this.applyDelta({ variantId, warehouseId, delta: qty });
  }

  /** Pull from a specific warehouse on order fulfillment. */
  async consumeForFulfillment(variantId: string, warehouseId: string, qty: number) {
    if (qty <= 0) throw new BadRequestException('qty must be > 0');
    return this.applyDelta({ variantId, warehouseId, delta: -qty });
  }

  // ---------- reads ----------

  async stocksForVariant(variantId: string) {
    return this.prisma.inventoryStock.findMany({
      where: { variantId },
      include: { warehouse: { select: { id: true, code: true, displayName: true, country: true, status: true } } },
    });
  }

  /** Return all variants' stock at a warehouse — used by the pick list and
   *  warehouse-staff inventory view. */
  async stocksForWarehouse(warehouseId: string) {
    return this.prisma.inventoryStock.findMany({
      where: { warehouseId },
      include: { variant: { include: { product: { select: { title: true, slug: true } } } } },
      orderBy: { quantityOnHand: 'desc' },
    });
  }

  async stockFor(variantId: string, warehouseId: string): Promise<number> {
    const row = await this.prisma.inventoryStock.findUnique({
      where: { variantId_warehouseId: { variantId, warehouseId } },
    });
    return row?.quantityOnHand ?? 0;
  }
}
