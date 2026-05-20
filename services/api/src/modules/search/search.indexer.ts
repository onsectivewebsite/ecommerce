import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EsClient } from './es-client';

const CHECKPOINT_KEY = 'product';

/**
 * Incremental indexer. Reads `Product.updatedAt > lastSeenAt` since the last
 * sweep and pushes those rows into ES via the bulk endpoint. Safe to run on
 * boot, on a schedule, or as a one-shot.
 *
 * NOTE: hard deletes need to call removeProduct() inline; we don't have a
 * `deletedAt` column to scan for. Soft deletes via `status=ARCHIVED` are
 * filtered out at query-time.
 */
@Injectable()
export class SearchIndexer implements OnModuleInit {
  private readonly logger = new Logger(SearchIndexer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly es: EsClient,
  ) {}

  async onModuleInit() {
    if (!this.es.isReady()) return;
    try { await this.es.ensureIndex(); }
    catch (e) { this.logger.warn(`ensureIndex skipped: ${(e as Error).message}`); }
  }

  async indexProduct(productId: string): Promise<void> {
    if (!this.es.isReady()) return;
    const p = await this.fetchOne(productId);
    if (!p) { await this.es.deleteDoc(productId); return; }
    const rating = await this.ratingFor(productId);
    await this.es.upsertDoc(p.id, toDoc(p, rating));
  }

  async removeProduct(productId: string): Promise<void> {
    if (!this.es.isReady()) return;
    await this.es.deleteDoc(productId);
  }

  /**
   * Pull the watermark, fetch all rows updated since, push to ES, advance watermark.
   * Idempotent: re-running with no new rows is a no-op.
   */
  async incrementalSync(batchSize = 500): Promise<{ indexed: number; errored: number }> {
    if (!this.es.isReady()) return { indexed: 0, errored: 0 };
    const checkpoint = await this.prisma.searchIndexCheckpoint.findUnique({
      where: { entityType: CHECKPOINT_KEY },
    });
    const since = checkpoint?.lastSeenAt ?? new Date(0);
    const rows = await this.prisma.product.findMany({
      where: { updatedAt: { gt: since } },
      orderBy: { updatedAt: 'asc' },
      take: batchSize,
      include: { seller: true, category: true, media: { orderBy: { position: 'asc' }, take: 4 } },
    });
    if (rows.length === 0) return { indexed: 0, errored: 0 };
    const result = await this.es.bulkUpsert(rows.map((p) => ({ id: p.id, doc: toDoc(p) })));
    const newest = rows[rows.length - 1].updatedAt;
    await this.prisma.searchIndexCheckpoint.upsert({
      where: { entityType: CHECKPOINT_KEY },
      create: { entityType: CHECKPOINT_KEY, lastSeenAt: newest },
      update: { lastSeenAt: newest },
    });
    this.logger.log(`Indexed ${result.ok}/${rows.length} products (errored=${result.errored}), watermark=${newest.toISOString()}`);
    return { indexed: result.ok, errored: result.errored };
  }

  /** Full rebuild — useful for the bootstrap Job in Helm. */
  async bulkSync(): Promise<{ indexed: number; errored: number }> {
    if (!this.es.isReady()) return { indexed: 0, errored: 0 };
    await this.es.ensureIndex();
    let total = { indexed: 0, errored: 0 };
    let cursor: Date | null = new Date(0);
    while (cursor) {
      const rows = await this.prisma.product.findMany({
        where: { updatedAt: { gt: cursor } },
        orderBy: { updatedAt: 'asc' },
        take: 500,
        include: { seller: true, category: true, media: { orderBy: { position: 'asc' }, take: 4 } },
      });
      if (rows.length === 0) break;
      const result = await this.es.bulkUpsert(rows.map((p) => ({ id: p.id, doc: toDoc(p) })));
      total.indexed += result.ok;
      total.errored += result.errored;
      cursor = rows[rows.length - 1].updatedAt;
      if (rows.length < 500) break;
    }
    await this.prisma.searchIndexCheckpoint.upsert({
      where: { entityType: CHECKPOINT_KEY },
      create: { entityType: CHECKPOINT_KEY, lastSeenAt: cursor ?? new Date() },
      update: { lastSeenAt: cursor ?? new Date() },
    });
    return total;
  }

  private fetchOne(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: { seller: true, category: true, media: { orderBy: { position: 'asc' }, take: 4 } },
    });
  }

  /**
   * Phase 9: pull the per-product rating aggregate so search can rank/filter by it.
   * Cheap aggregate query; safe to call from the per-item indexProduct path.
   * In bulkSync / incrementalSync we skip this (would N+1 the batch); rating values
   * land on the next per-product indexProduct call triggered by a review write.
   */
  private async ratingFor(productId: string): Promise<{ ratingAvg: number; ratingCount: number }> {
    const agg = await this.prisma.review.aggregate({
      where: { productId, status: 'VISIBLE' },
      _avg: { rating: true },
      _count: { _all: true },
    });
    return { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count._all };
  }
}

function toDoc(p: any, rating?: { ratingAvg: number; ratingCount: number }): Record<string, unknown> {
  return {
    slug: p.slug,
    title: p.title,
    description: p.description,
    attributes: Object.values(p.attributes ?? {}).join(' '),
    sellerId: p.sellerId,
    sellerName: p.seller?.displayName ?? '',
    categorySlug: p.category?.slug ?? '',
    status: p.status,
    currency: p.currency,
    basePriceMinor: p.basePriceMinor,
    isDigital: !!p.isDigital,
    ratingAvg: rating?.ratingAvg ?? 0,
    ratingCount: rating?.ratingCount ?? 0,
    media: (p.media ?? []).map((m: any) => ({ id: m.id, url: m.url, alt: m.alt ?? null, position: m.position })),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
