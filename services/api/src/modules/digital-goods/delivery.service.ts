import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import type { DigitalDeliveryDto, DigitalGoodType } from '@onsective/shared-types';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('order.paid')
  async onOrderPaid(payload: { orderId: string }) {
    if (!payload.orderId || payload.orderId.startsWith('sub_')) return;
    try {
      await this.deliverFor(payload.orderId);
    } catch (e) {
      this.logger.error(`Digital delivery failed for order ${payload.orderId}: ${(e as Error).message}`);
    }
  }

  /**
   * For each digital line in the order, create a DigitalDelivery row.
   * For LICENSE_KEY, atomically pull one AVAILABLE key from the pool via
   * a transactional update-where pattern (no SELECT FOR UPDATE needed).
   * For FILE_DOWNLOAD, the row is created without a license key.
   * Idempotent: re-running on the same order is a no-op because of the
   * @unique on DigitalDelivery.orderItemId.
   */
  async deliverFor(orderId: string): Promise<DigitalDeliveryDto[]> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: { include: { digitalProduct: true } },
              },
            },
            digitalDelivery: true,
          },
        },
      },
    });
    if (!order) return [];

    const out: DigitalDeliveryDto[] = [];
    for (const item of order.items) {
      const product = item.variant.product;
      const dp = product.digitalProduct;
      if (!product.isDigital || !dp) continue;
      if (item.digitalDelivery) {
        out.push(this.toDto(item.digitalDelivery, product, dp));
        continue;
      }

      const expiresAt = new Date(Date.now() + dp.expiryDays * 86400_000);

      if (dp.type === 'LICENSE_KEY') {
        // Loop to handle the rare case where two concurrent claims race for
        // the same key — `updateMany where status=AVAILABLE` is atomic, and
        // we re-pick if it claims 0 rows.
        let assigned: { id: string } | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = await this.prisma.licenseKey.findFirst({
            where: { digitalProductId: dp.id, status: 'AVAILABLE' },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          if (!candidate) break;
          const updated = await this.prisma.licenseKey.updateMany({
            where: { id: candidate.id, status: 'AVAILABLE' },
            data: { status: 'ASSIGNED', assignedOrderItemId: item.id, assignedAt: new Date() },
          });
          if (updated.count === 1) {
            assigned = candidate;
            break;
          }
        }
        if (!assigned) {
          this.logger.warn(
            `No license key available for digital product ${dp.id} (order item ${item.id}). ` +
              `Buyer will need a manual key from the seller.`,
          );
          // Still create a delivery row with no key so the buyer sees the line item
          // on /account/downloads with a "pending" indicator — admin/seller fixes via re-import.
        }

        const created = await this.prisma.digitalDelivery.create({
          data: {
            id: newId(),
            orderItemId: item.id,
            digitalProductId: dp.id,
            licenseKeyId: assigned?.id ?? null,
            expiresAt,
          },
        });
        out.push(this.toDto(created, product, dp));
      } else {
        // FILE_DOWNLOAD
        const created = await this.prisma.digitalDelivery.create({
          data: {
            id: newId(),
            orderItemId: item.id,
            digitalProductId: dp.id,
            expiresAt,
          },
        });
        out.push(this.toDto(created, product, dp));
      }
    }
    return out;
  }

  async listForUser(userId: string): Promise<DigitalDeliveryDto[]> {
    const rows = await this.prisma.digitalDelivery.findMany({
      where: { orderItem: { order: { userId } } },
      include: {
        orderItem: { include: { variant: { include: { product: { include: { digitalProduct: true } } } } } },
      },
      orderBy: { deliveredAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r, r.orderItem.variant.product, r.orderItem.variant.product.digitalProduct!));
  }

  private toDto(row: any, product: any, dp: any): DigitalDeliveryDto {
    return {
      id: row.id,
      orderItemId: row.orderItemId,
      productTitle: product.title,
      productSlug: product.slug,
      type: dp.type as DigitalGoodType,
      downloadCount: row.downloadCount ?? 0,
      downloadLimit: dp.downloadLimit,
      expiresAt: row.expiresAt.toISOString(),
      deliveredAt: row.deliveredAt.toISOString(),
      hasLicenseKey: !!row.licenseKeyId,
      fileSizeBytes: dp.fileSizeBytes ?? null,
      notesToBuyer: dp.notesToBuyer ?? null,
    };
  }
}
