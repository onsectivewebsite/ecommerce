import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { NotificationsService } from '../notifications/notifications.service';
import type { ForecastSeverity } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;
const VELOCITY_WINDOW_DAYS = 14;

interface ForecastRecord {
  variantId: string;
  sellerId: string;
  velocityPerDay: number;
  daysUntilEmpty: number;
  severity: ForecastSeverity;
}

/**
 * Velocity = sold units over the last N days / N. Projection assumes flat
 * demand — fine for the 7-day horizon, too naive for monthly planning.
 * Phase 11 ships this; a smarter forecaster lands when actual usage justifies
 * the complexity.
 *
 * De-dup: at most one alert per (variantId, severity). We re-fire on
 * severity escalations (WARNING → CRITICAL) but never re-fire the same
 * severity until the seller acknowledges it.
 */
@Injectable()
export class InventoryForecastService {
  private readonly logger = new Logger(InventoryForecastService.name);
  private readonly warnThresholdDays = Number(process.env.INVENTORY_WARN_DAYS ?? '7');
  private readonly criticalThresholdDays = Number(process.env.INVENTORY_CRITICAL_DAYS ?? '2');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly notifications: NotificationsService,
  ) {}

  /** Daily run: scan all active variants, write alerts, push notifications. */
  async runOnce(): Promise<{ scanned: number; alerts: number }> {
    const since = new Date(Date.now() - VELOCITY_WINDOW_DAYS * DAY_MS);
    const variants = await this.prisma.productVariant.findMany({
      where: { product: { status: 'ACTIVE' } },
      include: { product: { select: { id: true, sellerId: true, title: true, seller: { select: { userId: true } } } } },
      take: 50_000,
    });
    if (variants.length === 0) return { scanned: 0, alerts: 0 };

    // Pull purchase events in one query, then bucket in memory.
    const purchases = await this.prisma.productEvent.groupBy({
      where: { kind: 'PURCHASE', occurredAt: { gte: since }, variantId: { in: variants.map((v) => v.id) } },
      by: ['variantId'],
      _sum: { amountMinor: true },
      _count: { _all: true },
    });
    const purchasesByVariant = new Map<string, number>();
    for (const p of purchases) {
      if (p.variantId) purchasesByVariant.set(p.variantId, p._count._all);
    }

    let alerts = 0;
    for (const v of variants) {
      const sold = purchasesByVariant.get(v.id) ?? 0;
      const velocity = sold / VELOCITY_WINDOW_DAYS;
      if (velocity <= 0) continue;
      const daysUntilEmpty = v.inventoryQty / velocity;
      const severity: ForecastSeverity | null =
        daysUntilEmpty <= this.criticalThresholdDays ? 'CRITICAL' :
        daysUntilEmpty <= this.warnThresholdDays ? 'WARNING' :
        null;
      if (!severity) {
        // Clear any acknowledged-or-unacknowledged stale alerts when stock is healthy again.
        await this.prisma.inventoryForecastAlert.deleteMany({ where: { variantId: v.id } });
        continue;
      }
      const upserted = await this.upsertAlert({
        variantId: v.id,
        sellerId: v.product.sellerId,
        velocityPerDay: velocity,
        daysUntilEmpty,
        severity,
      });
      if (upserted) {
        alerts++;
        await this.notifyOnce(v.product.seller.userId, severity, v.name, velocity, daysUntilEmpty, v.id);
      }
    }
    return { scanned: variants.length, alerts };
  }

  private async upsertAlert(rec: ForecastRecord): Promise<boolean> {
    // Idempotent on (variantId, severity). Returns true if this was a fresh
    // insert (so we know to send a notification); false if we updated an
    // existing row of the same severity.
    const existing = await this.prisma.inventoryForecastAlert.findUnique({
      where: { variantId_severity: { variantId: rec.variantId, severity: rec.severity } },
    });
    if (existing) {
      // Re-fire if the previous alert was acknowledged AND severity is still warranted.
      if (existing.acknowledgedAt) {
        await this.prisma.inventoryForecastAlert.update({
          where: { id: existing.id },
          data: {
            velocityPerDay: rec.velocityPerDay,
            daysUntilEmpty: rec.daysUntilEmpty,
            acknowledgedAt: null,
          },
        });
        return true;
      }
      // Already alerted, not acknowledged — just refresh the numbers, no push.
      await this.prisma.inventoryForecastAlert.update({
        where: { id: existing.id },
        data: { velocityPerDay: rec.velocityPerDay, daysUntilEmpty: rec.daysUntilEmpty },
      });
      return false;
    }
    await this.prisma.inventoryForecastAlert.create({
      data: {
        id: newId(),
        variantId: rec.variantId,
        sellerId: rec.sellerId,
        severity: rec.severity,
        velocityPerDay: rec.velocityPerDay,
        daysUntilEmpty: rec.daysUntilEmpty,
      },
    });
    return true;
  }

  private async notifyOnce(
    sellerUserId: string,
    severity: ForecastSeverity,
    variantName: string,
    velocity: number,
    daysUntilEmpty: number,
    variantId: string,
  ) {
    const title = severity === 'CRITICAL' ? 'Critical low stock' : 'Low stock projected';
    const body = `"${variantName}" — ~${daysUntilEmpty.toFixed(1)} days at current sales rate.`;
    await this.notifications.sendToUser(sellerUserId, {
      title, body,
      data: { screen: 'Inventory', variantId },
      categoryId: 'inventory_low_stock',
    }).catch((e) => this.logger.warn(`low-stock push failed: ${(e as Error).message}`));
    this.events.emit('inventory.low_stock', {
      sellerUserId, variantName, velocity, daysUntilEmpty,
    });
  }

  // ---------- seller dashboard reads ----------

  async listForSeller(sellerUserId: string, includeAcknowledged = false) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new ForbiddenException('Seller profile required');
    return this.prisma.inventoryForecastAlert.findMany({
      where: {
        sellerId: seller.id,
        ...(includeAcknowledged ? {} : { acknowledgedAt: null }),
      },
      include: { variant: { include: { product: { select: { title: true, slug: true } } } } },
      orderBy: [{ severity: 'asc' }, { daysUntilEmpty: 'asc' }],
    });
  }

  async acknowledge(sellerUserId: string, alertId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new ForbiddenException('Seller profile required');
    const alert = await this.prisma.inventoryForecastAlert.findUnique({ where: { id: alertId } });
    if (!alert || alert.sellerId !== seller.id) throw new ForbiddenException('Not your alert');
    return this.prisma.inventoryForecastAlert.update({
      where: { id: alertId },
      data: { acknowledgedAt: new Date() },
    });
  }
}
