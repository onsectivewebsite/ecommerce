import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CertificationKind,
  type Prisma,
  ProductCondition,
  RefurbUnitAvailability,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import { SellerCertificationsService } from '../seller-certifications/seller-certifications.service';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface CreateRefurbUnitInput {
  productId: string;
  serialNumber: string;
  imei?: string;
  priceMinor: number;
  warehouseId?: string;
  conditionReport?: Record<string, unknown>;
  unitPhotoMediaIds?: string[];
}

export interface UpdateRefurbUnitInput {
  priceMinor?: number;
  conditionReport?: Record<string, unknown>;
  unitPhotoMediaIds?: string[];
  warehouseId?: string;
  withdraw?: boolean;
}

function warrantyMonthsFor(condition: ProductCondition): number {
  switch (condition) {
    case ProductCondition.REFURB_GRADE_A:
      return 12;
    case ProductCondition.REFURB_GRADE_B:
      return 6;
    case ProductCondition.REFURB_GRADE_C:
      return 1; // 30 days expressed as 1 month
    default:
      return 0;
  }
}

@Injectable()
export class RefurbUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
    private readonly certs: SellerCertificationsService,
  ) {}

  private async sellerOrThrow(userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('No seller profile');
    if (seller.status !== 'APPROVED') {
      throw new ForbiddenException('Seller not approved');
    }
    return seller;
  }

  async listForSeller(userId: string) {
    const seller = await this.sellerOrThrow(userId);
    return this.prisma.refurbUnit.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
      include: { product: { select: { id: true, slug: true, title: true, condition: true } } },
    });
  }

  async getPublic(unitId: string) {
    const unit = await this.prisma.refurbUnit.findUnique({
      where: { id: unitId },
      include: {
        product: { select: { id: true, slug: true, title: true, condition: true, brand: true } },
        seller: { select: { id: true, storeName: true, displayName: true } },
      },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  /** Public list of available units for a product. */
  listAvailableForProduct(productId: string) {
    return this.prisma.refurbUnit.findMany({
      where: { productId, availability: RefurbUnitAvailability.AVAILABLE },
      orderBy: { priceMinor: 'asc' },
    });
  }

  async create(userId: string, input: CreateRefurbUnitInput, actor: ActorMeta) {
    const seller = await this.sellerOrThrow(userId);
    await this.certs.assertHasActive(seller.id, CertificationKind.CERTIFIED_REFURBISHER);

    const product = await this.prisma.product.findUnique({
      where: { id: input.productId },
      include: { variants: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.sellerId !== seller.id) {
      throw new ForbiddenException('Product belongs to a different seller');
    }
    if (
      product.condition !== ProductCondition.REFURB_GRADE_A &&
      product.condition !== ProductCondition.REFURB_GRADE_B &&
      product.condition !== ProductCondition.REFURB_GRADE_C
    ) {
      throw new BadRequestException('Product condition must be REFURB_GRADE_*');
    }
    // Refurb products should not carry pooled variants. Reject if any exist
    // that aren't already singleton-refurb variants.
    const dup = await this.prisma.refurbUnit.findUnique({
      where: { productId_serialNumber: { productId: product.id, serialNumber: input.serialNumber } },
    });
    if (dup) throw new ConflictException('Unit with that serial already exists for this product');

    if (input.warehouseId) {
      const wh = await this.prisma.warehouse.findUnique({ where: { id: input.warehouseId } });
      if (!wh) throw new BadRequestException('Unknown warehouse');
    }

    const months = warrantyMonthsFor(product.condition);
    const unitId = newId();
    const variantId = newId();
    const sku = `RU-${product.id.slice(-6)}-${input.serialNumber}`.toUpperCase().slice(0, 64);

    const created = await this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.create({
        data: {
          id: variantId,
          productId: product.id,
          sku,
          name: `Unit ${input.serialNumber}`,
          priceMinor: input.priceMinor,
          inventoryQty: 1,
          weightGrams: 0,
          attributes: {
            refurbUnitId: unitId,
            serialNumber: input.serialNumber,
          } as object,
        },
      });
      const unit = await tx.refurbUnit.create({
        data: {
          id: unitId,
          productId: product.id,
          sellerId: seller.id,
          warehouseId: input.warehouseId ?? null,
          serialNumber: input.serialNumber,
          imei: input.imei ?? null,
          priceMinor: input.priceMinor,
          currency: product.currency,
          conditionReport: (input.conditionReport ?? {}) as object,
          unitPhotoMediaIds: input.unitPhotoMediaIds ?? [],
          // Default to QUARANTINED until an authenticity check passes —
          // never allow stock to go live just from publish.
          availability: RefurbUnitAvailability.QUARANTINED,
          warrantyMonths: months,
          variantId: variant.id,
        },
      });
      return unit;
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'refurb-unit.create',
      entityType: 'RefurbUnit',
      entityId: created.id,
      after: {
        productId: product.id,
        serial: input.serialNumber,
        priceMinor: input.priceMinor,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    this.events.emit('refurb-unit.created', { unitId: created.id, sellerId: seller.id });
    return created;
  }

  async update(userId: string, unitId: string, patch: UpdateRefurbUnitInput, actor: ActorMeta) {
    const seller = await this.sellerOrThrow(userId);
    const existing = await this.prisma.refurbUnit.findUnique({ where: { id: unitId } });
    if (!existing) throw new NotFoundException('Unit not found');
    if (existing.sellerId !== seller.id) throw new ForbiddenException();
    if (
      existing.availability === RefurbUnitAvailability.SOLD ||
      existing.availability === RefurbUnitAvailability.RESERVED
    ) {
      throw new BadRequestException('Cannot edit a sold or reserved unit');
    }

    const data: Prisma.RefurbUnitUpdateInput = {};
    if (patch.priceMinor !== undefined) data.priceMinor = patch.priceMinor;
    if (patch.conditionReport !== undefined) {
      data.conditionReport = patch.conditionReport as object;
    }
    if (patch.unitPhotoMediaIds !== undefined) data.unitPhotoMediaIds = patch.unitPhotoMediaIds;
    if (patch.warehouseId !== undefined) {
      data.warehouse = patch.warehouseId
        ? { connect: { id: patch.warehouseId } }
        : { disconnect: true };
    }
    if (patch.withdraw) data.availability = RefurbUnitAvailability.WITHDRAWN;

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.refurbUnit.update({ where: { id: unitId }, data });
      if (patch.priceMinor !== undefined && existing.variantId) {
        await tx.productVariant.update({
          where: { id: existing.variantId },
          data: { priceMinor: patch.priceMinor },
        });
      }
      if (patch.withdraw && existing.variantId) {
        await tx.productVariant.update({
          where: { id: existing.variantId },
          data: { inventoryQty: 0 },
        });
      }
      return u;
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'refurb-unit.update',
      entityType: 'RefurbUnit',
      entityId: unitId,
      before: existing,
      after: updated,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  }

  /**
   * Atomically reserves a unit for a cart. Used by cart-add. Returns the
   * unit on success. Two concurrent buyers cannot both succeed because the
   * update has a `availability=AVAILABLE` predicate which Prisma compiles
   * to a single UPDATE returning row count.
   */
  async reserveForCart(unitId: string, cartId: string, ttlMs = 15 * 60 * 1000) {
    const reservedUntil = new Date(Date.now() + ttlMs);
    const res = await this.prisma.refurbUnit.updateMany({
      where: {
        id: unitId,
        OR: [
          { availability: RefurbUnitAvailability.AVAILABLE },
          // Allow re-reservation by the same cart (idempotent extends ttl).
          { availability: RefurbUnitAvailability.RESERVED, reservedByCartId: cartId },
        ],
      },
      data: {
        availability: RefurbUnitAvailability.RESERVED,
        reservedByCartId: cartId,
        reservedUntil,
      },
    });
    if (res.count === 0) {
      throw new ConflictException('Refurb unit no longer available');
    }
    return this.prisma.refurbUnit.findUniqueOrThrow({ where: { id: unitId } });
  }

  async releaseFromCart(unitId: string, cartId: string) {
    await this.prisma.refurbUnit.updateMany({
      where: {
        id: unitId,
        availability: RefurbUnitAvailability.RESERVED,
        reservedByCartId: cartId,
      },
      data: {
        availability: RefurbUnitAvailability.AVAILABLE,
        reservedByCartId: null,
        reservedUntil: null,
      },
    });
  }

  /**
   * Atomically mark the unit SOLD as part of a checkout transaction.
   * Caller (orders service) must invoke this inside its tx to get true
   * atomicity. If the unit is no longer reservable by the cart, throws.
   */
  async markSoldInTx(
    tx: Prisma.TransactionClient,
    unitId: string,
    cartId: string,
    orderItemId: string,
  ) {
    const res = await tx.refurbUnit.updateMany({
      where: {
        id: unitId,
        OR: [
          { availability: RefurbUnitAvailability.RESERVED, reservedByCartId: cartId },
          { availability: RefurbUnitAvailability.AVAILABLE },
        ],
      },
      data: {
        availability: RefurbUnitAvailability.SOLD,
        reservedByCartId: null,
        reservedUntil: null,
        soldOrderItemId: orderItemId,
      },
    });
    if (res.count === 0) {
      throw new ConflictException('Refurb unit was sold to another buyer');
    }
    // Decrement the synthetic variant's qty so it disappears from listings.
    const unit = await tx.refurbUnit.findUniqueOrThrow({ where: { id: unitId } });
    if (unit.variantId) {
      await tx.productVariant.update({
        where: { id: unit.variantId },
        data: { inventoryQty: 0 },
      });
    }
  }

  /**
   * Called by an admin/warehouse flow when an authenticity check passes:
   * the unit transitions QUARANTINED → AVAILABLE.
   */
  async markAvailableAfterAuthCheck(unitId: string) {
    // Phase 22: stamp firstListedAt on first transition to AVAILABLE so the
    // outlet early-access filter can hide just-listed units from non-Plus
    // buyers. Re-transitions (e.g., after re-quarantine) keep the original
    // timestamp — the unit was already "listed" once.
    const existing = await this.prisma.refurbUnit.findUnique({
      where: { id: unitId },
      select: { firstListedAt: true },
    });
    await this.prisma.refurbUnit.updateMany({
      where: { id: unitId, availability: RefurbUnitAvailability.QUARANTINED },
      data: {
        availability: RefurbUnitAvailability.AVAILABLE,
        ...(existing?.firstListedAt ? {} : { firstListedAt: new Date() }),
      },
    });
    const unit = await this.prisma.refurbUnit.findUnique({ where: { id: unitId } });
    if (unit?.variantId) {
      await this.prisma.productVariant.update({
        where: { id: unit.variantId },
        data: { inventoryQty: 1 },
      });
    }
  }

  /** Inverse — used on FAIL or seller pause. */
  async quarantine(unitId: string, reason: string) {
    const unit = await this.prisma.refurbUnit.findUnique({ where: { id: unitId } });
    if (!unit) return;
    await this.prisma.refurbUnit.update({
      where: { id: unitId },
      data: { availability: RefurbUnitAvailability.QUARANTINED },
    });
    if (unit.variantId) {
      await this.prisma.productVariant.update({
        where: { id: unit.variantId },
        data: { inventoryQty: 0 },
      });
    }
    this.events.emit('refurb-unit.quarantined', { unitId, reason });
  }

  /** Lookup helper: given a variantId, return the RefurbUnit if any. */
  async findByVariantId(variantId: string) {
    return this.prisma.refurbUnit.findUnique({ where: { variantId } });
  }

  /** Public: serial-number lookup for buyers verifying authenticity. */
  async lookupBySerial(serialNumber: string) {
    const unit = await this.prisma.refurbUnit.findFirst({
      where: { serialNumber },
      include: {
        product: { select: { slug: true, title: true, condition: true } },
        authenticityChecks: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!unit) return null;
    return {
      serialNumber: unit.serialNumber,
      productSlug: unit.product.slug,
      productTitle: unit.product.title,
      condition: unit.product.condition,
      availability: unit.availability,
      checks: unit.authenticityChecks.map((c) => ({
        outcome: c.outcome,
        createdAt: c.createdAt,
        reason: c.reason,
      })),
    };
  }
}
