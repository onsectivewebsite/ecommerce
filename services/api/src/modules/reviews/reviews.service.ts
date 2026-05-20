import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import { SearchIndexer } from '../search/search.indexer';
import type { AdminHideDto, CreateReviewDto, SellerReplyDto } from './dto';

const REVIEW_WINDOW_DAYS = 90;

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly indexer: SearchIndexer,
    private readonly events: EventEmitter2,
  ) {}

  // ---------- buyer ----------

  async create(buyerUserId: string, dto: CreateReviewDto, actor: ActorMeta) {
    const orderItem = await this.prisma.orderItem.findUnique({
      where: { id: dto.orderItemId },
      include: { order: { include: { shipment: true } }, variant: true },
    });
    if (!orderItem) throw new NotFoundException('Order item not found');
    if (orderItem.order.userId !== buyerUserId) throw new ForbiddenException('Not your order');
    if (orderItem.order.status !== 'DELIVERED') {
      throw new BadRequestException('Reviews are only available after delivery');
    }
    const deliveredAt = orderItem.order.shipment?.deliveredAt;
    if (deliveredAt) {
      const ageDays = (Date.now() - deliveredAt.getTime()) / 86400_000;
      if (ageDays > REVIEW_WINDOW_DAYS) {
        throw new BadRequestException(`Review window of ${REVIEW_WINDOW_DAYS} days has passed`);
      }
    }
    const existing = await this.prisma.review.findUnique({ where: { orderItemId: dto.orderItemId } });
    if (existing) throw new ConflictException('Review already submitted for this item');

    const review = await this.prisma.review.create({
      data: {
        id: newId(),
        productId: orderItem.variant.productId,
        buyerUserId,
        orderItemId: orderItem.id,
        rating: dto.rating,
        title: dto.title ?? null,
        body: dto.body,
        status: 'VISIBLE',
      },
    });

    await this.refreshProductAggregate(orderItem.variant.productId);
    await this.audit.record({
      actorUserId: actor.userId, action: 'review.create', entityType: 'Review', entityId: review.id,
      after: { productId: review.productId, rating: review.rating },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('review.posted', { reviewId: review.id, productId: review.productId });
    return review;
  }

  async myReviews(userId: string) {
    return this.prisma.review.findMany({
      where: { buyerUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: { product: { select: { id: true, slug: true, title: true } } },
    });
  }

  async deleteByBuyer(buyerUserId: string, reviewId: string, actor: ActorMeta) {
    const r = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!r || r.buyerUserId !== buyerUserId) throw new NotFoundException('Review not found');
    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'DELETED_BY_BUYER' },
    });
    await this.refreshProductAggregate(r.productId);
    await this.audit.record({
      actorUserId: actor.userId, action: 'review.delete', entityType: 'Review', entityId: reviewId,
      before: { status: r.status }, after: { status: 'DELETED_BY_BUYER' },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  // ---------- seller ----------

  async sellerReply(sellerUserId: string, reviewId: string, dto: SellerReplyDto, actor: ActorMeta) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new ForbiddenException('Seller profile required');
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: { product: true },
    });
    if (!review || review.product.sellerId !== seller.id) throw new NotFoundException('Review not found');
    if (review.sellerReply) throw new ConflictException('Seller has already replied to this review');
    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { sellerReply: dto.reply, sellerRepliedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'review.seller_reply', entityType: 'Review', entityId: reviewId,
      after: { sellerReply: dto.reply },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  async listForSeller(sellerUserId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) return [];
    return this.prisma.review.findMany({
      where: { product: { sellerId: seller.id } },
      orderBy: { createdAt: 'desc' },
      include: { product: { select: { id: true, slug: true, title: true } } },
      take: 200,
    });
  }

  // ---------- admin ----------

  async adminList(status?: string) {
    return this.prisma.review.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { product: { select: { id: true, slug: true, title: true, sellerId: true } } },
      take: 200,
    });
  }

  async adminHide(reviewId: string, dto: AdminHideDto, actor: ActorMeta) {
    const r = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!r) throw new NotFoundException('Review not found');
    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'HIDDEN_BY_ADMIN', hiddenReason: dto.reason },
    });
    await this.refreshProductAggregate(r.productId);
    await this.audit.record({
      actorUserId: actor.userId, action: 'review.admin_hide', entityType: 'Review', entityId: reviewId,
      before: { status: r.status }, after: { status: 'HIDDEN_BY_ADMIN', reason: dto.reason },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  async adminUnhide(reviewId: string, actor: ActorMeta) {
    const r = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!r) throw new NotFoundException('Review not found');
    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'VISIBLE', hiddenReason: null },
    });
    await this.refreshProductAggregate(r.productId);
    await this.audit.record({
      actorUserId: actor.userId, action: 'review.admin_unhide', entityType: 'Review', entityId: reviewId,
      before: { status: r.status }, after: { status: 'VISIBLE' },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  // ---------- public ----------

  async publicListForProduct(productId: string, page = 1, pageSize = 20) {
    const where = { productId, status: 'VISIBLE' as const };
    const [total, items, dist] = await Promise.all([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { buyer: { select: { firstName: true } } },
      }),
      this.prisma.review.groupBy({
        where,
        by: ['rating'],
        _count: { _all: true },
      }),
    ]);
    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0, count = 0;
    for (const d of dist) {
      const r = d.rating as 1 | 2 | 3 | 4 | 5;
      distribution[r] = d._count._all;
      sum += d.rating * d._count._all;
      count += d._count._all;
    }
    return {
      total,
      page,
      pageSize,
      ratingAvg: count > 0 ? Math.round((sum / count) * 100) / 100 : 0,
      ratingCount: count,
      distribution,
      items: items.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        sellerReply: r.sellerReply,
        sellerRepliedAt: r.sellerRepliedAt?.toISOString() ?? null,
        buyerFirstName: r.buyer.firstName,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  // ---------- helpers ----------

  /**
   * Recompute the (avg, count) for a product and re-index it so search-rank-by-rating
   * stays consistent. Cheap: one aggregate query + one ES upsert.
   */
  async refreshProductAggregate(productId: string) {
    const agg = await this.prisma.review.aggregate({
      where: { productId, status: 'VISIBLE' },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const ratingAvg = agg._avg.rating ?? 0;
    const ratingCount = agg._count._all;
    // We don't materialize this on Product (no column for it yet); the search index
    // doc carries it. Keep both writes inside a try/catch so a missing ES cluster
    // doesn't break the review-create flow.
    try { await this.indexer.indexProduct(productId); }
    catch (e) { this.logger.warn(`review aggregate index update failed: ${(e as Error).message}`); }
    return { ratingAvg, ratingCount };
  }
}
