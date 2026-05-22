import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { OrdersService } from '../orders/orders.service';
import { NotificationFeedService } from '../notification-feed/notification-feed.service';
import type { CreateSubscriptionDto, UpdateSubscriptionDto } from './dto';

/** Standing Subscribe & Save discount, in basis points (5%). */
const SUBSCRIBE_SAVE_DISCOUNT_BPS = 500;
/** Consecutive failed runs before a subscription auto-pauses. */
const MAX_FAILURES = 3;
/** Retry delay (days) after a failed run, before the pause threshold. */
const RETRY_DAYS = 2;

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86400_000);
}

interface DueResult { processed: number; succeeded: number; failed: number; skipped: number }

@Injectable()
export class AutoshipService {
  private readonly logger = new Logger(AutoshipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly feed: NotificationFeedService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------- buyer ----------

  async subscribe(userId: string, dto: CreateSubscriptionDto) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: dto.variantId },
      include: { product: true },
    });
    if (!variant || variant.product.status !== 'ACTIVE') {
      throw new NotFoundException('Product not found');
    }
    if (variant.product.isDigital) {
      throw new BadRequestException('Digital products cannot be subscribed to');
    }
    const address = await this.prisma.address.findFirst({
      where: { id: dto.shippingAddressId, userId },
    });
    if (!address) throw new BadRequestException('Shipping address not found');

    const sub = await this.prisma.productSubscription.create({
      data: {
        id: newId(),
        buyerUserId: userId,
        variantId: dto.variantId,
        shippingAddressId: dto.shippingAddressId,
        qty: dto.qty,
        intervalDays: dto.intervalDays,
        discountBps: SUBSCRIBE_SAVE_DISCOUNT_BPS,
        status: 'ACTIVE',
        nextRunAt: addDays(new Date(), dto.intervalDays),
      },
    });
    this.events.emit('autoship.subscribed', { subscriptionId: sub.id, userId });
    return this.getOne(userId, sub.id);
  }

  async listMine(userId: string) {
    const subs = await this.prisma.productSubscription.findMany({
      where: { buyerUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: { variant: { include: { product: { select: { slug: true, title: true, currency: true } } } } },
    });
    return subs.map((s) => this.toApi(s));
  }

  async getOne(userId: string, id: string) {
    const sub = await this.prisma.productSubscription.findUnique({
      where: { id },
      include: { variant: { include: { product: { select: { slug: true, title: true, currency: true } } } } },
    });
    if (!sub || sub.buyerUserId !== userId) throw new NotFoundException('Subscription not found');
    return this.toApi(sub);
  }

  async update(userId: string, id: string, dto: UpdateSubscriptionDto) {
    const sub = await this.requireOwned(userId, id);
    if (sub.status === 'CANCELLED') throw new BadRequestException('Subscription is cancelled');
    if (dto.shippingAddressId) {
      const address = await this.prisma.address.findFirst({
        where: { id: dto.shippingAddressId, userId },
      });
      if (!address) throw new BadRequestException('Shipping address not found');
    }
    await this.prisma.productSubscription.update({
      where: { id },
      data: {
        qty: dto.qty ?? undefined,
        intervalDays: dto.intervalDays ?? undefined,
        shippingAddressId: dto.shippingAddressId ?? undefined,
      },
    });
    return this.getOne(userId, id);
  }

  async skip(userId: string, id: string) {
    const sub = await this.requireOwned(userId, id);
    if (sub.status !== 'ACTIVE') throw new BadRequestException('Only active subscriptions can skip');
    await this.prisma.productSubscription.update({
      where: { id },
      data: { skipNextRun: true },
    });
    return this.getOne(userId, id);
  }

  async pause(userId: string, id: string) {
    const sub = await this.requireOwned(userId, id);
    if (sub.status === 'CANCELLED') throw new BadRequestException('Subscription is cancelled');
    await this.prisma.productSubscription.update({
      where: { id },
      data: { status: 'PAUSED' },
    });
    return this.getOne(userId, id);
  }

  async resume(userId: string, id: string) {
    const sub = await this.requireOwned(userId, id);
    if (sub.status === 'CANCELLED') throw new BadRequestException('Subscription is cancelled');
    await this.prisma.productSubscription.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        failureCount: 0,
        skipNextRun: false,
        nextRunAt: addDays(new Date(), sub.intervalDays),
      },
    });
    return this.getOne(userId, id);
  }

  async cancel(userId: string, id: string) {
    const sub = await this.requireOwned(userId, id);
    if (sub.status === 'CANCELLED') return this.getOne(userId, id);
    await this.prisma.productSubscription.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    this.events.emit('autoship.cancelled', { subscriptionId: id, userId });
    return this.getOne(userId, id);
  }

  // ---------- scheduler ----------

  /**
   * Process every ACTIVE subscription whose nextRunAt has passed. Each run
   * either places + charges an order, skips a cycle, or records a failure.
   * Safe to call repeatedly — a subscription only advances once its
   * nextRunAt is reached.
   */
  async processDue(now = new Date()): Promise<DueResult> {
    const due = await this.prisma.productSubscription.findMany({
      where: { status: 'ACTIVE', nextRunAt: { lte: now } },
      take: 200,
    });
    const result: DueResult = { processed: 0, succeeded: 0, failed: 0, skipped: 0 };

    for (const sub of due) {
      result.processed++;
      try {
        if (sub.skipNextRun) {
          await this.prisma.productSubscription.update({
            where: { id: sub.id },
            data: {
              skipNextRun: false,
              lastRunAt: now,
              lastRunStatus: 'SKIPPED',
              nextRunAt: addDays(now, sub.intervalDays),
            },
          });
          result.skipped++;
          continue;
        }

        const run = await this.orders.createSubscriptionOrder({
          userId: sub.buyerUserId,
          variantId: sub.variantId,
          qty: sub.qty,
          shippingAddressId: sub.shippingAddressId,
          discountBps: sub.discountBps,
        });

        if (run.ok) {
          await this.prisma.productSubscription.update({
            where: { id: sub.id },
            data: {
              failureCount: 0,
              lastRunAt: now,
              lastRunStatus: 'SUCCESS',
              nextRunAt: addDays(now, sub.intervalDays),
            },
          });
          result.succeeded++;
        } else {
          const failureCount = sub.failureCount + 1;
          if (failureCount >= MAX_FAILURES) {
            await this.prisma.productSubscription.update({
              where: { id: sub.id },
              data: {
                failureCount,
                lastRunAt: now,
                lastRunStatus: run.reason ?? 'failed',
                status: 'PAUSED',
              },
            });
            await this.feed.write({
              userId: sub.buyerUserId,
              kind: 'GENERIC',
              title: 'Subscribe & Save paused',
              body: `We couldn't place your recurring order after ${MAX_FAILURES} tries. Update your payment method to resume it.`,
              deepLinkPath: '/account/subscriptions',
              payload: { subscriptionId: sub.id, reason: run.reason ?? 'failed' },
            });
          } else {
            await this.prisma.productSubscription.update({
              where: { id: sub.id },
              data: {
                failureCount,
                lastRunAt: now,
                lastRunStatus: run.reason ?? 'failed',
                nextRunAt: addDays(now, RETRY_DAYS),
              },
            });
          }
          result.failed++;
          this.logger.warn(`autoship run failed sub=${sub.id} reason=${run.reason}`);
        }
      } catch (e) {
        result.failed++;
        this.logger.error(`autoship run threw for sub=${sub.id}: ${(e as Error).message}`);
      }
    }
    return result;
  }

  // ---------- helpers ----------

  private async requireOwned(userId: string, id: string) {
    const sub = await this.prisma.productSubscription.findUnique({ where: { id } });
    if (!sub || sub.buyerUserId !== userId) throw new NotFoundException('Subscription not found');
    return sub;
  }

  private toApi(s: {
    id: string; status: string; qty: number; intervalDays: number; discountBps: number;
    nextRunAt: Date; lastRunAt: Date | null; lastRunStatus: string | null;
    failureCount: number; skipNextRun: boolean; shippingAddressId: string; createdAt: Date;
    variantId: string;
    variant: { name: string; priceMinor: number; product: { slug: string; title: string; currency: string } };
  }) {
    const unitPriceMinor = s.variant.priceMinor;
    const discountedUnitMinor = unitPriceMinor - Math.round((unitPriceMinor * s.discountBps) / 10000);
    return {
      id: s.id,
      status: s.status,
      qty: s.qty,
      intervalDays: s.intervalDays,
      discountBps: s.discountBps,
      nextRunAt: s.nextRunAt.toISOString(),
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
      lastRunStatus: s.lastRunStatus,
      failureCount: s.failureCount,
      skipNextRun: s.skipNextRun,
      shippingAddressId: s.shippingAddressId,
      createdAt: s.createdAt.toISOString(),
      variantId: s.variantId,
      variantName: s.variant.name,
      unitPriceMinor,
      discountedUnitMinor,
      currency: s.variant.product.currency,
      product: { slug: s.variant.product.slug, title: s.variant.product.title },
    };
  }
}
