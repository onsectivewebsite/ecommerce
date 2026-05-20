import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import { InventoryStockService } from './inventory-stock.service';

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

export interface CreateInboundInput {
  warehouseId: string;
  carrierCode?: string;
  trackingNumber?: string;
  note?: string;
  items: Array<{ variantId: string; expectedQty: number }>;
}

export interface ReceiveLineInput {
  variantId: string;
  receivedQty: number;
  discrepancyQty?: number;
}

@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: InventoryStockService,
  ) {}

  // ---------- seller-facing ----------

  async create(sellerUserId: string, input: CreateInboundInput, actor: ActorMeta) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new ForbiddenException('Seller profile required');
    const wh = await this.prisma.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!wh || wh.status !== 'ACTIVE') throw new BadRequestException('Warehouse not available');
    if (input.items.length === 0) throw new BadRequestException('At least one item required');
    // All variants must belong to this seller — no cross-seller injection.
    const variantIds = input.items.map((i) => i.variantId);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: { select: { sellerId: true } } },
    });
    for (const v of variants) {
      if (v.product.sellerId !== seller.id) {
        throw new ForbiddenException(`Variant ${v.id} does not belong to your account`);
      }
    }
    const created = await this.prisma.inboundShipment.create({
      data: {
        id: newId(),
        sellerId: seller.id,
        warehouseId: input.warehouseId,
        status: 'DRAFT',
        carrierCode: input.carrierCode ?? null,
        trackingNumber: input.trackingNumber ?? null,
        note: input.note ?? null,
        items: {
          create: input.items.map((i) => ({
            id: newId(), variantId: i.variantId, expectedQty: i.expectedQty,
          })),
        },
      },
      include: { items: true },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'inbound.create', entityType: 'InboundShipment', entityId: created.id,
      after: { warehouseId: input.warehouseId, itemCount: input.items.length },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return created;
  }

  async listForSeller(sellerUserId: string, status?: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) return [];
    return this.prisma.inboundShipment.findMany({
      where: {
        sellerId: seller.id,
        ...(status ? { status: status as any } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { items: true, warehouse: { select: { code: true, displayName: true } } },
      take: 100,
    });
  }

  async markShipped(sellerUserId: string, id: string, body: { carrierCode: string; trackingNumber: string }, actor: ActorMeta) {
    const ship = await this.ownOrThrow(sellerUserId, id);
    if (ship.status !== 'DRAFT') throw new BadRequestException('Only DRAFT shipments can be shipped');
    const updated = await this.prisma.inboundShipment.update({
      where: { id: ship.id },
      data: {
        status: 'IN_TRANSIT',
        carrierCode: body.carrierCode,
        trackingNumber: body.trackingNumber,
        shippedAt: new Date(),
      },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'inbound.ship', entityType: 'InboundShipment', entityId: id,
      after: { carrierCode: body.carrierCode, trackingNumber: body.trackingNumber },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  async cancel(sellerUserId: string, id: string, actor: ActorMeta) {
    const ship = await this.ownOrThrow(sellerUserId, id);
    if (!['DRAFT', 'IN_TRANSIT'].includes(ship.status)) {
      throw new BadRequestException(`Cannot cancel a ${ship.status} shipment`);
    }
    const updated = await this.prisma.inboundShipment.update({
      where: { id: ship.id }, data: { status: 'CANCELLED' },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'inbound.cancel', entityType: 'InboundShipment', entityId: id,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  // ---------- warehouse-staff facing (admin or shipper role) ----------

  async listAtWarehouse(warehouseId: string, status?: string) {
    return this.prisma.inboundShipment.findMany({
      where: { warehouseId, ...(status ? { status: status as any } : { status: { in: ['IN_TRANSIT'] } }) },
      orderBy: { shippedAt: 'asc' },
      include: { items: { include: { variant: { include: { product: { select: { title: true, slug: true } } } } } }, seller: { select: { id: true, displayName: true } } },
      take: 100,
    });
  }

  /**
   * Receive an inbound — atomically: per-line stock bumps + rollup recompute
   * happen inside InventoryStockService.applyDelta. We then mark the shipment
   * RECEIVED so accounting knows when stock landed.
   */
  async receive(
    id: string,
    receipt: ReceiveLineInput[],
    actor: ActorMeta,
  ) {
    const ship = await this.prisma.inboundShipment.findUnique({
      where: { id }, include: { items: true },
    });
    if (!ship) throw new NotFoundException('Inbound not found');
    if (ship.status !== 'IN_TRANSIT') {
      throw new BadRequestException(`Cannot receive a ${ship.status} shipment`);
    }
    // Validate every received line exists on the shipment.
    const byVariant = new Map(ship.items.map((i) => [i.variantId, i]));
    for (const r of receipt) {
      const line = byVariant.get(r.variantId);
      if (!line) throw new BadRequestException(`Variant ${r.variantId} not on shipment`);
      if (r.receivedQty < 0) throw new BadRequestException('receivedQty must be ≥ 0');
      if (r.receivedQty > line.expectedQty + 10) {
        throw new BadRequestException(`receivedQty for ${r.variantId} exceeds expected by > 10 — please escalate`);
      }
    }
    // Phase 14: receive records the quantity but does NOT release live stock.
    // Stock only goes live after a PASS AuthenticityCheck via AuthenticityService.
    // This is the mandatory inbound auth gate — there is no override path here.
    for (const r of receipt) {
      const line = byVariant.get(r.variantId)!;
      const discrepancy = r.discrepancyQty ?? (line.expectedQty - r.receivedQty);
      await this.prisma.inboundShipmentItem.update({
        where: { id: line.id },
        data: { receivedQty: r.receivedQty, discrepancyQty: discrepancy },
      });
    }
    const updated = await this.prisma.inboundShipment.update({
      where: { id: ship.id },
      data: { status: 'RECEIVED', receivedAt: new Date() },
      include: { items: true },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'inbound.receive', entityType: 'InboundShipment', entityId: id,
      after: { receivedCount: receipt.length },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  async close(id: string, actor: ActorMeta) {
    const ship = await this.prisma.inboundShipment.findUnique({ where: { id } });
    if (!ship) throw new NotFoundException('Inbound not found');
    if (ship.status !== 'RECEIVED') {
      throw new BadRequestException('Only RECEIVED shipments can be closed');
    }
    const updated = await this.prisma.inboundShipment.update({
      where: { id }, data: { status: 'CLOSED', closedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'inbound.close', entityType: 'InboundShipment', entityId: id,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  // ---------- helpers ----------

  private async ownOrThrow(sellerUserId: string, id: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new ForbiddenException('Seller profile required');
    const ship = await this.prisma.inboundShipment.findUnique({ where: { id } });
    if (!ship || ship.sellerId !== seller.id) throw new NotFoundException('Shipment not found');
    return ship;
  }
}
