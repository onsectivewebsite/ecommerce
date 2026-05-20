import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';

const DEFAULT_RATE_USD_PER_CM3_DAY = 0.00002; // ≈ $0.60 / cubic-foot / month

/**
 * Daily storage accrual. We snapshot per-(seller, warehouse, day) the stored
 * volume × daily rate, writing a row to StorageBillingRun. A monthly run
 * sums these into a single ListingFeeCharge-style charge against the seller.
 *
 * Two-phase split is intentional: daily snapshots give fair accruals even if
 * inventory moves mid-month; the monthly aggregation keeps the payout
 * statement readable.
 */
@Injectable()
export class StorageFeesService {
  private readonly logger = new Logger(StorageFeesService.name);
  private readonly rate = Number(process.env.STORAGE_RATE_USD_PER_CM3_DAY ?? DEFAULT_RATE_USD_PER_CM3_DAY);

  constructor(private readonly prisma: PrismaService) {}

  /** Run daily — writes one row per (seller, warehouse) for the previous day. */
  async accrueForYesterday(): Promise<{ rows: number; totalFeeMinor: number }> {
    const day = startOfYesterdayUtc();
    return this.accrueForDate(day);
  }

  async accrueForDate(day: Date): Promise<{ rows: number; totalFeeMinor: number }> {
    const stocks = await this.prisma.inventoryStock.findMany({
      where: { quantityOnHand: { gt: 0 } },
      include: {
        variant: { select: { cubicCm: true, product: { select: { sellerId: true } } } },
        warehouse: { select: { id: true } },
      },
    });
    // Group by (sellerId, warehouseId) → sum cubicCm × qty.
    const acc = new Map<string, { sellerId: string; warehouseId: string; cubicCmStored: number }>();
    for (const s of stocks) {
      const key = `${s.variant.product.sellerId}:${s.warehouseId}`;
      const cubic = s.variant.cubicCm * s.quantityOnHand;
      const existing = acc.get(key);
      if (existing) existing.cubicCmStored += cubic;
      else acc.set(key, { sellerId: s.variant.product.sellerId, warehouseId: s.warehouseId, cubicCmStored: cubic });
    }
    let totalFeeMinor = 0;
    let rows = 0;
    for (const { sellerId, warehouseId, cubicCmStored } of acc.values()) {
      const feeUsd = cubicCmStored * this.rate; // dollars
      const feeMinor = Math.round(feeUsd * 100);
      if (feeMinor === 0) continue;
      try {
        await this.prisma.storageBillingRun.upsert({
          where: { sellerId_warehouseId_forDay: { sellerId, warehouseId, forDay: day } },
          create: { id: newId(), sellerId, warehouseId, forDay: day, cubicCmStored, feeMinor },
          update: { cubicCmStored, feeMinor },
        });
        totalFeeMinor += feeMinor;
        rows++;
      } catch (e) {
        this.logger.warn(`storage accrual upsert failed for ${sellerId}/${warehouseId}: ${(e as Error).message}`);
      }
    }
    return { rows, totalFeeMinor };
  }

  /** Read-side: seller's storage statement for a window. */
  async statementForSeller(sellerUserId: string, days = 30) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) return { totalFeeMinor: 0, currency: 'USD', rows: [] };
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.storageBillingRun.findMany({
      where: { sellerId: seller.id, forDay: { gte: since } },
      orderBy: [{ forDay: 'desc' }],
      take: 500,
    });
    const totalFeeMinor = rows.reduce((s, r) => s + r.feeMinor, 0);
    return { totalFeeMinor, currency: 'USD', rows };
  }
}

function startOfYesterdayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}
