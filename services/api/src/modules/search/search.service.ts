import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EsClient } from './es-client';
import type {
  CurrencyCode,
  PaginatedProducts,
  ProductStatus,
  ProductSummaryDto,
} from '@onsective/shared-types';

export interface SearchParams {
  query?: string;
  category?: string;
  page?: number;
  pageSize?: number;
}

export interface SearchResult extends PaginatedProducts {
  source: 'elasticsearch' | 'postgres';
  suggestion?: string | null;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly es: EsClient,
  ) {}

  async search(params: SearchParams): Promise<SearchResult> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(60, Math.max(1, params.pageSize ?? 24));

    if (this.es.isReady()) {
      try {
        return await this.searchEs(params, page, pageSize);
      } catch (e) {
        this.logger.warn(`ES search failed, falling back to pg: ${(e as Error).message}`);
      }
    }
    return this.searchPg(params, page, pageSize);
  }

  private async searchEs(params: SearchParams, page: number, pageSize: number): Promise<SearchResult> {
    const q = (params.query ?? '').trim();
    const must: unknown[] = [{ term: { status: 'ACTIVE' } }];
    if (params.category) must.push({ term: { categorySlug: params.category } });
    const body: Record<string, unknown> = {
      from: (page - 1) * pageSize,
      size: pageSize,
      query: q
        ? {
            bool: {
              must,
              should: [
                { match: { title: { query: q, boost: 4, fuzziness: 'AUTO' } } },
                { match: { attributes: { query: q, boost: 2 } } },
                { match: { description: { query: q, boost: 1, fuzziness: 'AUTO' } } },
                { match: { sellerName: { query: q, boost: 1.5 } } },
              ],
              minimum_should_match: 1,
            },
          }
        : { bool: { must } },
      sort: q
        ? [{ _score: 'desc' }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }],
      suggest: q
        ? {
            text: q,
            title_suggest: { term: { field: 'title', suggest_mode: 'popular' } },
          }
        : undefined,
    };
    const result = await this.es.search(body);
    const items: ProductSummaryDto[] = result.hits.map((h) => ({
      id: h._id,
      slug: h._source.slug,
      title: h._source.title,
      currency: h._source.currency as CurrencyCode,
      basePriceMinor: h._source.basePriceMinor,
      media: h._source.media ?? [],
      sellerName: h._source.sellerName,
      categorySlug: h._source.categorySlug,
      status: h._source.status as ProductStatus,
    }));
    return {
      items,
      total: result.total,
      page,
      pageSize,
      source: 'elasticsearch',
      suggestion: null,
    };
  }

  private async searchPg(params: SearchParams, page: number, pageSize: number): Promise<SearchResult> {
    const where: Prisma.ProductWhereInput = { status: 'ACTIVE' };
    if (params.category) where.category = { slug: params.category };
    if (params.query?.trim()) {
      const q = params.query.trim();
      where.OR = [
        { title:       { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          media: { orderBy: { position: 'asc' } },
          seller: true,
          category: true,
        },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      source: 'postgres',
      items: rows.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        currency: p.currency as CurrencyCode,
        basePriceMinor: p.basePriceMinor,
        media: p.media.map((m) => ({ id: m.id, url: m.url, alt: m.alt ?? null, position: m.position })),
        sellerName: p.seller.displayName,
        categorySlug: p.category.slug,
        status: p.status as ProductStatus,
      })),
    };
  }
}
