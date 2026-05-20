import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ProductCondition,
  RefurbUnitAvailability,
  ReturnDisposition,
  type Prisma,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../loyalty/membership.service';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface InspectionInput {
  returnId: string;
  warehouseId: string;
  disposition: ReturnDisposition;
  conditionNotes?: string;
  photoUrls?: string[];
  /** For OUTLET_RELIST. Defaults to 1500 (15%) if not provided. */
  outletDiscountBps?: number;
  /** For DISPOSE: required reason. */
  disposeReason?: string;
}

const DEFAULT_OUTLET_DISCOUNT_BPS = 1500; // 15%
const OPEN_BOX_WARRANTY_MONTHS = 6;

/**
 * Warehouse return disposition. Sibling to Phase 9 ReturnsService — that
 * service owns the refund/approval lifecycle; this one owns "what
 * physically happens to the unit when it arrives at our warehouse."
 */
@Injectable()
export class ReturnsDispositionService {
  private readonly logger = new Logger(ReturnsDispositionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly membership: MembershipService,
    private readonly cfg: ConfigService,
  ) {}

  pendingQueue(warehouseId?: string) {
    return this.prisma.return.findMany({
      where: {
        status: { in: ['APPROVED', 'SHIPPED', 'RECEIVED'] },
        inspection: { is: null },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: {
        items: {
          include: {
            orderItem: { include: { variant: { include: { product: true } } } },
          },
        },
        order: { select: { id: true, sellerId: true } },
      },
    });
  }

  recentDispositions(limit = 50) {
    return this.prisma.returnInspection.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
      include: {
        return: { select: { id: true, orderId: true, sellerId: true } },
      },
    });
  }

  async inspect(input: InspectionInput, actor: ActorMeta) {
    const ret = await this.prisma.return.findUnique({
      where: { id: input.returnId },
      include: {
        items: {
          include: {
            orderItem: { include: { variant: { include: { product: true } } } },
          },
        },
      },
    });
    if (!ret) throw new NotFoundException('Return not found');

    const existing = await this.prisma.returnInspection.findUnique({
      where: { returnId: input.returnId },
    });
    if (existing) throw new ConflictException('Return already inspected');

    const wh = await this.prisma.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!wh) throw new BadRequestException('Unknown warehouse');

    if (input.disposition === ReturnDisposition.DISPOSE && !input.disposeReason) {
      throw new BadRequestException('disposeReason required for DISPOSE');
    }

    // Choose the source product to attach the OPEN_BOX listing to. A return
    // can cover multiple line items; we use the first item's product as the
    // attach point. Multi-item returns with mixed products fall through to
    // REFURB_REGRADE (operator handles manually).
    const firstItem = ret.items[0];
    const sourceProduct = firstItem?.orderItem.variant.product ?? null;

    if (
      input.disposition === ReturnDisposition.OUTLET_RELIST &&
      (!sourceProduct || ret.items.length > 1)
    ) {
      throw new BadRequestException(
        'OUTLET_RELIST requires a single-item return tied to a known product',
      );
    }

    const discountBps = input.outletDiscountBps ?? DEFAULT_OUTLET_DISCOUNT_BPS;
    if (discountBps < 0 || discountBps > 5000) {
      throw new BadRequestException('outletDiscountBps must be between 0 and 5000');
    }

    let createdRefurbUnitId: string | null = null;

    if (input.disposition === ReturnDisposition.OUTLET_RELIST && sourceProduct) {
      createdRefurbUnitId = await this.createOpenBoxUnit({
        sourceProduct,
        returnId: ret.id,
        sellerId: ret.sellerId,
        warehouseId: input.warehouseId,
        discountBps,
        notes: input.conditionNotes,
        photos: input.photoUrls ?? [],
      });
    }

    const inspection = await this.prisma.returnInspection.create({
      data: {
        id: newId(),
        returnId: input.returnId,
        warehouseId: input.warehouseId,
        technicianUserId: actor.userId,
        disposition: input.disposition,
        conditionNotes: input.conditionNotes ?? null,
        photoUrls: input.photoUrls ?? [],
        outletDiscountBps: input.disposition === ReturnDisposition.OUTLET_RELIST ? discountBps : null,
        createdRefurbUnitId,
        disposeReason: input.disposition === ReturnDisposition.DISPOSE ? input.disposeReason ?? null : null,
      },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: `returns.disposition.${input.disposition.toLowerCase()}`,
      entityType: 'ReturnInspection',
      entityId: inspection.id,
      after: {
        returnId: ret.id,
        disposition: input.disposition,
        createdRefurbUnitId,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    // Phase 18 events for downstream consumers (seller-health, refurb pipeline).
    this.events.emit('return.disposed', {
      returnId: ret.id,
      sellerId: ret.sellerId,
      disposition: input.disposition,
    });
    if (input.disposition === ReturnDisposition.REFURB_REGRADE) {
      this.events.emit('return.refurb-regrade', {
        returnId: ret.id,
        sourceProductId: sourceProduct?.id ?? null,
        warehouseId: input.warehouseId,
      });
    }
    if (input.disposition === ReturnDisposition.RETURN_TO_SELLER) {
      this.events.emit('return.ship-back-to-seller', {
        returnId: ret.id,
        sellerId: ret.sellerId,
      });
    }

    return inspection;
  }

  /**
   * Create the OPEN_BOX RefurbUnit with the singleton-variant pattern from
   * Phase 14. The unit starts QUARANTINED so the AuthenticityCheck PASS is
   * still required before stock goes live — single chokepoint preserved.
   */
  private async createOpenBoxUnit(args: {
    sourceProduct: { id: string; basePriceMinor: number; currency: string; condition: ProductCondition };
    returnId: string;
    sellerId: string;
    warehouseId: string;
    discountBps: number;
    notes?: string;
    photos: string[];
  }): Promise<string> {
    const { sourceProduct } = args;
    const priceMinor = Math.max(
      0,
      Math.round(sourceProduct.basePriceMinor * (1 - args.discountBps / 10000)),
    );
    const unitId = newId();
    const variantId = newId();
    const serial = `RT-${args.returnId.slice(-10)}`.toUpperCase();
    const sku = `OB-${unitId.slice(-8)}`.toUpperCase().slice(0, 64);

    await this.prisma.$transaction(async (tx) => {
      await tx.productVariant.create({
        data: {
          id: variantId,
          productId: sourceProduct.id,
          sku,
          name: `Open-box unit ${serial}`,
          priceMinor,
          inventoryQty: 0, // auth check will bump to 1
          weightGrams: 0,
          attributes: {
            refurbUnitId: unitId,
            source: 'return-outlet',
            returnId: args.returnId,
          } as object,
        },
      });
      await tx.refurbUnit.create({
        data: {
          id: unitId,
          productId: sourceProduct.id,
          sellerId: args.sellerId,
          warehouseId: args.warehouseId,
          serialNumber: serial,
          priceMinor,
          currency: sourceProduct.currency,
          conditionReport: {
            source: 'return-outlet',
            returnId: args.returnId,
            inspectorNotes: args.notes ?? null,
            discountBps: args.discountBps,
          } as object,
          unitPhotoMediaIds: args.photos,
          availability: RefurbUnitAvailability.QUARANTINED,
          warrantyMonths: OPEN_BOX_WARRANTY_MONTHS,
          variantId,
        },
      });
    });
    return unitId;
  }

  // ---- buyer outlet aggregator ----

  /**
   * Returns products whose condition is in the outlet set AND that have at
   * least one AVAILABLE RefurbUnit. Each card carries the cheapest live
   * unit price + a computed discount vs. the source's basePriceMinor.
   */
  async outletListings(params: {
    brand?: string;
    condition?: ProductCondition;
    limit?: number;
    earlyAccess?: boolean;
    callerUserId?: string;
  } = {}) {
    const outletConditions: ProductCondition[] = [
      ProductCondition.OPEN_BOX,
      ProductCondition.REFURB_GRADE_A,
      ProductCondition.REFURB_GRADE_B,
      ProductCondition.REFURB_GRADE_C,
    ];
    const condFilter = params.condition && outletConditions.includes(params.condition)
      ? [params.condition]
      : outletConditions;

    // Phase 22 — Plus early access. Non-Plus buyers (anonymous or signed-in)
    // only see units whose `firstListedAt` is older than the early-access
    // window. Plus members opting in (earlyAccess=true) see everything.
    const requestedEarly = !!params.earlyAccess && !!params.callerUserId;
    const isPlus = requestedEarly
      ? await this.membership.isActiveForUser(params.callerUserId!)
      : false;
    const earlyWindowHours = Number(
      this.cfg.get<string>('LOYALTY_EARLY_ACCESS_HOURS') ?? '24',
    );
    const cutoff = new Date(Date.now() - earlyWindowHours * 60 * 60 * 1000);

    const availableUnitFilter: Prisma.RefurbUnitWhereInput = {
      availability: RefurbUnitAvailability.AVAILABLE,
      ...(isPlus
        ? {}
        : { OR: [{ firstListedAt: null }, { firstListedAt: { lt: cutoff } }] }),
    };

    const where: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      condition: { in: condFilter },
      refurbUnits: { some: availableUnitFilter },
    };
    if (params.brand) {
      where.brand = { slug: params.brand };
    }

    const products = await this.prisma.product.findMany({
      where,
      include: {
        media: { orderBy: { position: 'asc' }, take: 1 },
        seller: { select: { displayName: true } },
        category: { select: { slug: true } },
        brand: { select: { slug: true, name: true, logoUrl: true } },
        refurbUnits: {
          where: availableUnitFilter,
          orderBy: { priceMinor: 'asc' },
          take: 1,
          select: { id: true, priceMinor: true, currency: true, warrantyMonths: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(120, params.limit ?? 60),
    });

    return products.map((p) => {
      const cheapest = p.refurbUnits[0]!;
      const discountBps = p.basePriceMinor > 0
        ? Math.max(0, Math.round(((p.basePriceMinor - cheapest.priceMinor) / p.basePriceMinor) * 10000))
        : 0;
      return {
        productId: p.id,
        slug: p.slug,
        title: p.title,
        condition: p.condition,
        sellerName: p.seller.displayName,
        categorySlug: p.category.slug,
        brand: p.brand ? { slug: p.brand.slug, name: p.brand.name, logoUrl: p.brand.logoUrl } : null,
        media: p.media,
        msrpMinor: p.basePriceMinor,
        outletPriceMinor: cheapest.priceMinor,
        currency: cheapest.currency,
        discountBps,
        warrantyMonths: cheapest.warrantyMonths,
      };
    });
  }
}
