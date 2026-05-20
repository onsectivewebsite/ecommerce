import { Injectable, Logger } from '@nestjs/common';
import type { WarehouseSlaProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RoutableLine {
  variantId: string;
  productId: string;
  fulfillmentMode: 'SELLER' | 'PLATFORM';
  qty: number;
}

export interface RouteResult {
  /** When set, ALL platform-fulfilled lines route to this one warehouse. */
  warehouseId: string | null;
  /** True when at least one platform-fulfilled line could not be satisfied
   *  from any single warehouse — caller should fall back to seller fulfillment
   *  for the entire order with a slow-shipping notice. */
  fallback: boolean;
  reason?: string;
}

/**
 * Phase 21: per-item routing decision. Each item gets its own
 * warehouse pick + SLA profile (when one exists for that warehouse +
 * destination). null warehouseId means no eligible platform warehouse
 * found — caller treats as seller-fulfilled (legacy path).
 */
export interface PerItemRouteResult {
  variantId: string;
  warehouseId: string | null;
  slaProfile: WarehouseSlaProfile | null;
}

/**
 * Single-warehouse-per-order routing (Phase 13 invariant). Picks the
 * warehouse that (a) covers the buyer's zone, (b) has stock for every
 * platform-fulfilled line in the cart, and (c) sorts by priority then
 * zone specificity.
 *
 * If no single warehouse satisfies all lines, we fall back to seller-
 * fulfillment for the whole order. Splitting is a known follow-up.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async chooseForOrder(input: {
    country: string;
    region?: string | null;
    lines: RoutableLine[];
  }): Promise<RouteResult> {
    const platformLines = input.lines.filter((l) => l.fulfillmentMode === 'PLATFORM');
    if (platformLines.length === 0) {
      return { warehouseId: null, fallback: false };
    }

    // 1) candidate warehouses by zone match.
    const country = input.country.toUpperCase();
    const region = (input.region ?? '').toUpperCase();
    const candidates = await this.prisma.warehouse.findMany({
      where: { status: 'ACTIVE', zones: { some: { country } } },
      include: { zones: true },
      orderBy: { priority: 'asc' },
    });
    if (candidates.length === 0) {
      return { warehouseId: null, fallback: true, reason: `No warehouse covers ${country}` };
    }

    // 2) filter to zones that match country AND (region whitelist empty OR contains region).
    const zoneMatched = candidates.filter((w) =>
      w.zones.some((z) =>
        z.country === country && (z.regions.length === 0 || (region && z.regions.includes(region))),
      ),
    );
    const ranked = zoneMatched.length > 0 ? zoneMatched : candidates;

    // 3) for each, check stock for every platform-fulfilled line. First hit wins.
    const variantIds = platformLines.map((l) => l.variantId);
    for (const wh of ranked) {
      const stocks = await this.prisma.inventoryStock.findMany({
        where: { warehouseId: wh.id, variantId: { in: variantIds } },
      });
      const byVariant = new Map(stocks.map((s) => [s.variantId, s.quantityOnHand]));
      const allCovered = platformLines.every((l) => (byVariant.get(l.variantId) ?? 0) >= l.qty);
      if (allCovered) {
        return { warehouseId: wh.id, fallback: false };
      }
    }
    return {
      warehouseId: null,
      fallback: true,
      reason: 'No single warehouse can satisfy all platform-fulfilled lines',
    };
  }

  /**
   * Phase 21: per-item routing. Returns one decision per platform-fulfilled
   * line independently. Lines whose product is SELLER-fulfilled aren't
   * included in the result. Lines with no eligible warehouse return
   * warehouseId=null and slaProfile=null — caller treats as seller-fulfilled.
   */
  async chooseForOrderPerItem(input: {
    country: string;
    region?: string | null;
    lines: RoutableLine[];
  }): Promise<PerItemRouteResult[]> {
    const country = input.country.toUpperCase();
    const region = (input.region ?? '').toUpperCase();
    const platformLines = input.lines.filter((l) => l.fulfillmentMode === 'PLATFORM');
    if (platformLines.length === 0) return [];

    const candidates = await this.prisma.warehouse.findMany({
      where: { status: 'ACTIVE', zones: { some: { country } } },
      include: { zones: true },
      orderBy: { priority: 'asc' },
    });
    const zoneMatched = candidates.filter((w) =>
      w.zones.some((z) =>
        z.country === country && (z.regions.length === 0 || (region && z.regions.includes(region))),
      ),
    );
    const ranked = zoneMatched.length > 0 ? zoneMatched : candidates;
    if (ranked.length === 0) {
      return platformLines.map((l) => ({ variantId: l.variantId, warehouseId: null, slaProfile: null }));
    }

    // Bulk-load stocks once for all candidate warehouses + variants.
    const variantIds = platformLines.map((l) => l.variantId);
    const stocks = await this.prisma.inventoryStock.findMany({
      where: { warehouseId: { in: ranked.map((w) => w.id) }, variantId: { in: variantIds } },
    });
    const byKey = new Map<string, number>();
    for (const s of stocks) byKey.set(`${s.warehouseId}:${s.variantId}`, s.quantityOnHand);

    // Pre-resolve SLA profiles for each ranked warehouse + destination.
    const profileByWarehouse = new Map<string, WarehouseSlaProfile | null>();
    for (const wh of ranked) {
      const profile = await this.resolveSlaProfile(wh.id, country, region);
      profileByWarehouse.set(wh.id, profile);
    }

    return platformLines.map((line) => {
      for (const wh of ranked) {
        const onHand = byKey.get(`${wh.id}:${line.variantId}`) ?? 0;
        if (onHand >= line.qty) {
          return {
            variantId: line.variantId,
            warehouseId: wh.id,
            slaProfile: profileByWarehouse.get(wh.id) ?? null,
          };
        }
      }
      return { variantId: line.variantId, warehouseId: null, slaProfile: null };
    });
  }

  /**
   * Resolves a WarehouseSlaProfile: (warehouseId, country, region) beats
   * (warehouseId, country, null). Used by both checkout snapshot and the
   * PDP estimate path.
   */
  async resolveSlaProfile(warehouseId: string, country: string, region: string | null) {
    const c = country.toUpperCase();
    const r = (region ?? '').toUpperCase();
    if (r) {
      const specific = await this.prisma.warehouseSlaProfile.findUnique({
        where: { warehouseId_country_region: { warehouseId, country: c, region: r } },
      }).catch(() => null);
      if (specific) return specific;
    }
    return this.prisma.warehouseSlaProfile.findUnique({
      where: { warehouseId_country_region: { warehouseId, country: c, region: null } },
    }).catch(() => null);
  }
}
