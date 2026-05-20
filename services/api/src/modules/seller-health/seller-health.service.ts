import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { NotificationsService } from '../notifications/notifications.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

/**
 * Composite seller health = 100 - weighted penalty across four signals.
 *
 *   dispute rate      40%
 *   chargeback rate   30%
 *   return rate       20%
 *   SLA breach rate   10%
 *
 * Each signal is the count of bad-events / orders in the window. Below
 * `SELLER_HEALTH_PAUSE_THRESHOLD` the seller is suspended automatically and
 * the seller + admin are notified.
 *
 * Health snapshots are point-in-time so we can chart trend; we never compute
 * health at read time.
 */
@Injectable()
export class SellerHealthService {
  private readonly logger = new Logger(SellerHealthService.name);
  private readonly pauseThreshold = Number(process.env.SELLER_HEALTH_PAUSE_THRESHOLD ?? '40');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly notifications: NotificationsService,
  ) {}

  async snapshotAllActive(): Promise<{ snapshots: number; paused: number }> {
    const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS);
    const sellers = await this.prisma.seller.findMany({
      where: { status: { in: ['APPROVED'] } },
      select: { id: true, userId: true, displayName: true },
      take: 10_000,
    });
    let snapshots = 0;
    let paused = 0;
    for (const seller of sellers) {
      try {
        const { score, signals } = await this.computeFor(seller.id, since);
        await this.prisma.sellerHealthSnapshot.create({
          data: {
            id: newId(),
            sellerId: seller.id,
            score,
            disputeRate: signals.disputeRate,
            chargebackRate: signals.chargebackRate,
            returnRate: signals.returnRate,
            slaBreachRate: signals.slaBreachRate,
            ordersConsidered: signals.orders,
            windowDays: WINDOW_DAYS,
            reasons: signals.reasons as unknown as object,
          },
        });
        snapshots++;
        if (score < this.pauseThreshold && signals.orders >= 5) {
          // Need a minimum order count to avoid pausing brand-new sellers on
          // a single returned package — 5 orders is the floor.
          const updated = await this.prisma.seller.update({
            where: { id: seller.id },
            data: { status: 'SUSPENDED' },
          });
          paused++;
          this.events.emit('seller.suspended', { sellerId: seller.id, score });
          await this.notifications.sendToUser(seller.userId, {
            title: 'Seller account suspended',
            body: `Health score ${score}/100 dropped below the operating threshold. Contact support to appeal.`,
            data: { screen: 'Health' },
            categoryId: 'seller_health_low',
          }).catch(() => undefined);
          this.logger.warn(`Auto-paused seller ${seller.id} (${updated.displayName}) — score=${score}`);
        }
      } catch (e) {
        this.logger.warn(`health snapshot failed for ${seller.id}: ${(e as Error).message}`);
      }
    }
    return { snapshots, paused };
  }

  private async computeFor(sellerId: string, since: Date) {
    const [orders, disputes, chargebacks, returnUnits, slaBreaches] = await Promise.all([
      this.prisma.order.count({ where: { sellerId, createdAt: { gte: since } } }),
      this.prisma.dispute.count({
        where: {
          openedAt: { gte: since },
          thread: { sellerId },
          kind: { in: ['RETURN', 'MISSING_DELIVERY', 'OTHER'] },
        },
      }),
      this.prisma.dispute.count({
        where: { openedAt: { gte: since }, thread: { sellerId }, kind: 'CHARGEBACK' },
      }),
      this.prisma.return.count({ where: { sellerId, createdAt: { gte: since } } }),
      this.countSlaBreaches(sellerId, since),
    ]);

    const safeRate = (num: number, denom: number) => (denom > 0 ? num / denom : 0);
    const disputeRate = safeRate(disputes, orders);
    const chargebackRate = safeRate(chargebacks, orders);
    const returnRate = safeRate(returnUnits, orders);
    const slaBreachRate = safeRate(slaBreaches, orders);

    // Penalty model: each rate of 10% contributes its share of the weight.
    const penalty =
      disputeRate * 100 * 0.4 +
      chargebackRate * 100 * 0.3 +
      returnRate * 100 * 0.2 +
      slaBreachRate * 100 * 0.1;
    const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

    const reasons: string[] = [];
    if (disputeRate > 0.05) reasons.push(`Dispute rate ${(disputeRate * 100).toFixed(1)}% (>5%)`);
    if (chargebackRate > 0.01) reasons.push(`Chargeback rate ${(chargebackRate * 100).toFixed(2)}% (>1%)`);
    if (returnRate > 0.15) reasons.push(`Return rate ${(returnRate * 100).toFixed(1)}% (>15%)`);
    if (slaBreachRate > 0.1) reasons.push(`SLA-breach rate ${(slaBreachRate * 100).toFixed(1)}% (>10%)`);

    return {
      score,
      signals: { orders, disputeRate, chargebackRate, returnRate, slaBreachRate, reasons },
    };
  }

  private async countSlaBreaches(sellerId: string, since: Date) {
    // SLA breach: a thread that sat in WAITING_SELLER beyond the SLA hours
    // window (Phase 9 default 48h). Best-effort heuristic: messages that
    // sat without seller reply for > 48h within the window.
    const slaCutoffMs = 48 * 60 * 60 * 1000;
    const threads = await this.prisma.messageThread.findMany({
      where: { sellerId, lastMessageAt: { gte: since } },
      select: { id: true, status: true, lastMessageAt: true, createdAt: true },
    });
    let breaches = 0;
    for (const t of threads) {
      if (t.status === 'WAITING_SELLER') {
        const age = Date.now() - t.lastMessageAt.getTime();
        if (age >= slaCutoffMs) breaches++;
      }
    }
    return breaches;
  }

  // ---------- read APIs ----------

  async sellerOverview(sellerUserId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new ForbiddenException('Seller profile required');
    const [latest, trend] = await Promise.all([
      this.prisma.sellerHealthSnapshot.findFirst({
        where: { sellerId: seller.id },
        orderBy: { capturedAt: 'desc' },
      }),
      this.prisma.sellerHealthSnapshot.findMany({
        where: { sellerId: seller.id },
        orderBy: { capturedAt: 'desc' },
        take: 30,
      }),
    ]);
    return {
      sellerStatus: seller.status,
      latest,
      trend: trend.map((t) => ({ date: t.capturedAt.toISOString().slice(0, 10), score: t.score })).reverse(),
    };
  }

  async adminList(minScore?: number) {
    const snaps = await this.prisma.sellerHealthSnapshot.findMany({
      where: minScore != null ? { score: { lte: minScore } } : undefined,
      orderBy: [{ score: 'asc' }, { capturedAt: 'desc' }],
      distinct: ['sellerId'],
      take: 200,
      include: { seller: { select: { displayName: true, status: true } } },
    });
    return snaps;
  }
}
