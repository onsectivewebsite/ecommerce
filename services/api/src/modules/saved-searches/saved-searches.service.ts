import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { NotificationFeedService } from '../notification-feed/notification-feed.service';
import type { CreateSavedSearchDto } from './dto';

interface RunResult { savedSearchId: string; newMatches: number }

@Injectable()
export class SavedSearchesService {
  private readonly logger = new Logger(SavedSearchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feed: NotificationFeedService,
  ) {}

  async create(userId: string, dto: CreateSavedSearchDto) {
    const ss = await this.prisma.savedSearch.create({
      data: {
        id: newId(),
        userId,
        q: dto.q.trim(),
        name: dto.name?.trim() || null,
      },
    });
    return this.toApi(ss, 0);
  }

  async list(userId: string) {
    const rows = await this.prisma.savedSearch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { hits: true } } },
    });
    return rows.map((r) => this.toApi(r, r._count.hits));
  }

  async remove(userId: string, id: string) {
    const ss = await this.prisma.savedSearch.findUnique({ where: { id } });
    if (!ss || ss.userId !== userId) throw new NotFoundException('Saved search not found');
    await this.prisma.savedSearch.delete({ where: { id } });
    return { ok: true };
  }

  /** On-demand single-search evaluation. */
  async runOnce(savedSearchId: string): Promise<RunResult> {
    const ss = await this.prisma.savedSearch.findUnique({
      where: { id: savedSearchId },
      include: { hits: { select: { productId: true } } },
    });
    if (!ss) throw new NotFoundException('Saved search not found');

    const matched = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { title: { contains: ss.q, mode: 'insensitive' } },
          { description: { contains: ss.q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, title: true },
      take: 100,
    });

    const known = new Set(ss.hits.map((h) => h.productId));
    const fresh = matched.filter((p) => !known.has(p.id));

    if (fresh.length > 0) {
      await this.prisma.savedSearchHit.createMany({
        data: fresh.map((p) => ({
          id: newId(),
          savedSearchId: ss.id,
          productId: p.id,
        })),
        skipDuplicates: true,
      });
      const top = fresh.slice(0, 3).map((p) => p.title).join(', ');
      await this.feed.write({
        userId: ss.userId,
        kind: 'SAVED_SEARCH_MATCH',
        title: `${fresh.length} new ${fresh.length === 1 ? 'match' : 'matches'} for "${ss.q}"`,
        body: top + (fresh.length > 3 ? '…' : ''),
        deepLinkPath: `/search?query=${encodeURIComponent(ss.q)}`,
        payload: { savedSearchId: ss.id, count: fresh.length },
      });
    }

    await this.prisma.savedSearch.update({
      where: { id: ss.id },
      data: { lastCheckedAt: new Date() },
    });
    return { savedSearchId: ss.id, newMatches: fresh.length };
  }

  /** Scheduler entry point — process every saved search. */
  async scan(): Promise<{ processed: number; totalNewMatches: number }> {
    const all = await this.prisma.savedSearch.findMany({ select: { id: true }, take: 1000 });
    let total = 0;
    for (const { id } of all) {
      try {
        const r = await this.runOnce(id);
        total += r.newMatches;
      } catch (e) {
        this.logger.warn(`saved-search runOnce failed for ${id}: ${(e as Error).message}`);
      }
    }
    return { processed: all.length, totalNewMatches: total };
  }

  // ---------- helpers ----------

  private toApi(
    ss: { id: string; q: string; name: string | null; lastCheckedAt: Date; createdAt: Date },
    hitCount: number,
  ) {
    return {
      id: ss.id,
      q: ss.q,
      name: ss.name,
      hitCount,
      lastCheckedAt: ss.lastCheckedAt.toISOString(),
      createdAt: ss.createdAt.toISOString(),
    };
  }
}
