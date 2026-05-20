import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SlaBreachKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import { RoutingService } from '../fulfillment/routing.service';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface UpsertProfileInput {
  warehouseId: string;
  country: string;
  region?: string | null;
  shipDays: number;
  deliveryDays: number;
  notes?: string;
}

export interface EstimateInput {
  productId: string;
  country: string;
  region?: string | null;
  qty?: number;
}

export interface EstimateResult {
  warehouseId: string | null;
  shipDays: number | null;
  deliveryDays: number | null;
  shipBy: string | null;
  deliverBy: string | null;
}

@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly routing: RoutingService,
  ) {}

  // ---------------- profile management ----------------

  listProfiles(warehouseId?: string) {
    return this.prisma.warehouseSlaProfile.findMany({
      where: warehouseId ? { warehouseId } : {},
      orderBy: [{ warehouseId: 'asc' }, { country: 'asc' }, { region: 'asc' }],
      include: { warehouse: { select: { id: true, code: true, displayName: true } } },
    });
  }

  async upsertProfile(input: UpsertProfileInput, actor: ActorMeta) {
    if (input.shipDays < 0 || input.deliveryDays < input.shipDays) {
      throw new BadRequestException('deliveryDays must be ≥ shipDays ≥ 0');
    }
    const wh = await this.prisma.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!wh) throw new BadRequestException('Warehouse not found');

    const country = input.country.toUpperCase();
    const region = input.region ? input.region.toUpperCase() : null;
    const before = await this.prisma.warehouseSlaProfile.findUnique({
      where: { warehouseId_country_region: { warehouseId: input.warehouseId, country, region } },
    }).catch(() => null);

    const row = await this.prisma.warehouseSlaProfile.upsert({
      where: {
        warehouseId_country_region: { warehouseId: input.warehouseId, country, region },
      },
      create: {
        id: newId(),
        warehouseId: input.warehouseId,
        country,
        region,
        shipDays: input.shipDays,
        deliveryDays: input.deliveryDays,
        notes: input.notes ?? null,
      },
      update: {
        shipDays: input.shipDays,
        deliveryDays: input.deliveryDays,
        notes: input.notes ?? null,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'sla.profile.upsert',
      entityType: 'WarehouseSlaProfile',
      entityId: row.id,
      before, after: row,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return row;
  }

  async deleteProfile(id: string, actor: ActorMeta) {
    const before = await this.prisma.warehouseSlaProfile.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Profile not found');
    await this.prisma.warehouseSlaProfile.delete({ where: { id } });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'sla.profile.delete',
      entityType: 'WarehouseSlaProfile',
      entityId: id,
      before,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return { ok: true };
  }

  // ---------------- PDP estimate ----------------

  /**
   * Find the best (lowest deliveryDays) warehouse that can serve this
   * product/qty for the destination, and return its profile + wall-clock
   * promise dates. Used by the PDP "Get it by" line.
   */
  async estimateForBuyer(input: EstimateInput): Promise<EstimateResult> {
    const qty = input.qty ?? 1;
    // Use the first ACTIVE variant's id as the canonical line. Refurb
    // products may have synthetic singleton variants — we just need any
    // variant id to ask the routing path.
    const product = await this.prisma.product.findUnique({
      where: { id: input.productId },
      include: { variants: { take: 5 } },
    });
    if (!product || product.variants.length === 0) {
      return this.emptyEstimate();
    }
    // Pick the in-stock variant with the lowest deliveryDays across
    // eligible warehouses. Brute-force loop is fine — PDP-level call.
    let best: EstimateResult = this.emptyEstimate();
    for (const v of product.variants) {
      const per = await this.routing.chooseForOrderPerItem({
        country: input.country,
        region: input.region ?? null,
        lines: [{
          variantId: v.id,
          productId: product.id,
          fulfillmentMode: product.fulfillmentMode === 'PLATFORM' ? 'PLATFORM' : 'PLATFORM',
          qty,
        }],
      });
      const decision = per[0];
      if (!decision?.warehouseId || !decision.slaProfile) continue;
      const cand = this.materializePromise(decision.warehouseId, decision.slaProfile);
      if (!best.warehouseId || (cand.deliveryDays ?? Infinity) < (best.deliveryDays ?? Infinity)) {
        best = cand;
      }
    }
    return best;
  }

  private materializePromise(warehouseId: string, profile: { shipDays: number; deliveryDays: number }): EstimateResult {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    return {
      warehouseId,
      shipDays: profile.shipDays,
      deliveryDays: profile.deliveryDays,
      shipBy: new Date(now + profile.shipDays * dayMs).toISOString(),
      deliverBy: new Date(now + profile.deliveryDays * dayMs).toISOString(),
    };
  }

  private emptyEstimate(): EstimateResult {
    return { warehouseId: null, shipDays: null, deliveryDays: null, shipBy: null, deliverBy: null };
  }

  // ---------------- checkout snapshot ----------------

  /**
   * Compute the snapshot fields to store on an OrderItem from a routing
   * decision. Pure function — no DB writes; caller composes into its
   * order-create transaction.
   */
  snapshotPromise(profile: { shipDays: number; deliveryDays: number } | null) {
    if (!profile) {
      return { promisedShipBy: null, promisedDeliverBy: null, slaWindowDays: null };
    }
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    return {
      promisedShipBy: new Date(now + profile.shipDays * dayMs),
      promisedDeliverBy: new Date(now + profile.deliveryDays * dayMs),
      slaWindowDays: profile.deliveryDays,
    };
  }

  // ---------------- breach scan ----------------

  /**
   * Idempotent scan. Called by SlaBreachScheduler. Writes one SlaBreach
   * row per (orderItemId, kind) that has passed its promise without
   * completion. Re-runs are no-ops thanks to the unique constraint.
   */
  async scanBreaches(): Promise<{ shipBreaches: number; deliverBreaches: number }> {
    const now = new Date();
    let shipBreaches = 0;
    let deliverBreaches = 0;

    const shipCandidates = await this.prisma.orderItem.findMany({
      where: {
        promisedShipBy: { lt: now },
        pickedAt: null,
        slaBreaches: { none: { kind: SlaBreachKind.SHIP } },
      },
      include: { order: { select: { sellerId: true } } },
      take: 500,
    });
    for (const i of shipCandidates) {
      try {
        const promised = i.promisedShipBy!;
        await this.prisma.slaBreach.create({
          data: {
            id: newId(),
            orderItemId: i.id,
            kind: SlaBreachKind.SHIP,
            promisedAt: promised,
            breachHours: hoursBetween(promised, now),
            sellerId: i.order.sellerId,
          },
        });
        shipBreaches++;
      } catch (e) {
        this.logger.warn(`SHIP breach write failed for ${i.id}: ${(e as Error).message}`);
      }
    }

    const deliverCandidates = await this.prisma.orderItem.findMany({
      where: {
        promisedDeliverBy: { lt: now },
        slaBreaches: { none: { kind: SlaBreachKind.DELIVER } },
        order: { shipment: { deliveredAt: null } },
      },
      include: { order: { select: { sellerId: true } } },
      take: 500,
    });
    for (const i of deliverCandidates) {
      try {
        const promised = i.promisedDeliverBy!;
        await this.prisma.slaBreach.create({
          data: {
            id: newId(),
            orderItemId: i.id,
            kind: SlaBreachKind.DELIVER,
            promisedAt: promised,
            breachHours: hoursBetween(promised, now),
            sellerId: i.order.sellerId,
          },
        });
        deliverBreaches++;
      } catch (e) {
        this.logger.warn(`DELIVER breach write failed for ${i.id}: ${(e as Error).message}`);
      }
    }

    if (shipBreaches > 0 || deliverBreaches > 0) {
      this.logger.warn(`SLA breach scan: ship=${shipBreaches} deliver=${deliverBreaches}`);
    }
    return { shipBreaches, deliverBreaches };
  }

  // ---------------- reads for admin dashboard ----------------

  recentBreaches(limit = 100) {
    return this.prisma.slaBreach.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
      include: {
        orderItem: { select: { id: true, productTitleSnapshot: true, orderId: true } },
      },
    });
  }
}

function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / (60 * 60 * 1000));
}
