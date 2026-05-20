import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PickListService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Items at this warehouse that have been routed but not picked yet.
   * Sorted oldest order first; warehouse staff can re-sort by SKU client-side
   * for batch picking.
   */
  async pickListForWarehouse(warehouseId: string) {
    const items = await this.prisma.orderItem.findMany({
      where: {
        fulfilledFromWarehouseId: warehouseId,
        pickedAt: { not: null }, // only items where stock was debited (i.e. paid)
        order: { status: { in: ['PAID'] } },
      },
      include: {
        order: {
          select: {
            id: true, userId: true, currency: true, totalMinor: true,
            shippingAddress: { select: { fullName: true, city: true, region: true, country: true, postalCode: true } },
          },
        },
        variant: {
          select: {
            id: true, sku: true, name: true,
            product: { select: { title: true } },
            stocks: { where: { warehouseId }, select: { binLocation: true } },
          },
        },
      },
      orderBy: [{ order: { createdAt: 'asc' } }, { id: 'asc' }],
      take: 500,
    });
    return items.map((i) => ({
      orderItemId: i.id,
      orderId: i.order.id,
      orderShort: i.order.id.slice(-8),
      sku: i.variant.sku,
      productTitle: i.variant.product.title,
      variantName: i.variant.name,
      qty: i.qty,
      binLocation: i.variant.stocks[0]?.binLocation ?? null,
      shipTo: i.order.shippingAddress
        ? `${i.order.shippingAddress.fullName} · ${i.order.shippingAddress.city}, ${i.order.shippingAddress.region} ${i.order.shippingAddress.postalCode} ${i.order.shippingAddress.country}`
        : '',
      pickedAt: i.pickedAt?.toISOString() ?? null,
    }));
  }

  async warehouseSummary(warehouseId: string) {
    const wh = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, code: true, displayName: true, country: true, region: true, city: true },
    });
    return wh;
  }
}
