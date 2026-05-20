import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CategoryDto,
  ComplianceRequirementKind,
  PaginatedProducts,
  ProductCondition,
  ProductDetailDto,
  ProductSummaryDto,
  CurrencyCode,
  ProductStatus,
} from '@onsective/shared-types';

interface ListParams {
  query?: string;
  category?: string;
  sellerId?: string;
  page?: number;
  pageSize?: number;
  statuses?: ProductStatus[];
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async listCategories(): Promise<CategoryDto[]> {
    const rows = await this.prisma.category.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }] });
    return rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      parentId: c.parentId,
      position: c.position,
    }));
  }

  async listProducts(params: ListParams = {}): Promise<PaginatedProducts> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(60, Math.max(1, params.pageSize ?? 24));
    const statuses = params.statuses ?? (['ACTIVE'] as ProductStatus[]);

    const where: Prisma.ProductWhereInput = { status: { in: statuses } };
    if (params.sellerId) where.sellerId = params.sellerId;
    if (params.category) where.category = { slug: params.category };
    if (params.query?.trim()) {
      const q = params.query.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await this.prisma.$transaction([
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
          brand: true,
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: items.map<ProductSummaryDto>((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        currency: p.currency as CurrencyCode,
        basePriceMinor: p.basePriceMinor,
        media: p.media.map((m) => ({ id: m.id, url: m.url, alt: m.alt ?? null, position: m.position })),
        sellerName: p.seller.displayName,
        categorySlug: p.category.slug,
        status: p.status as ProductStatus,
        condition: p.condition as ProductCondition,
        brand: p.brand
          ? { id: p.brand.id, slug: p.brand.slug, name: p.brand.name, logoUrl: p.brand.logoUrl ?? null }
          : null,
      })),
    };
  }

  async getProduct(slug: string): Promise<ProductDetailDto> {
    const p = await this.prisma.product.findUnique({
      where: { slug },
      include: {
        media: { orderBy: { position: 'asc' } },
        variants: { orderBy: { createdAt: 'asc' } },
        seller: true,
        category: { include: { compliance: true } },
        digitalProduct: true,
        brand: true,
      },
    });
    if (!p || p.status === 'ARCHIVED') throw new NotFoundException('Product not found');
    // Phase 11: emit a view event for seller analytics. Fire-and-forget.
    this.events.emit('product.viewed', { productId: p.id });
    const rule = p.category.compliance;
    const minAge = p.minBuyerAge ?? rule?.minBuyerAge ?? null;
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      currency: p.currency as CurrencyCode,
      basePriceMinor: p.basePriceMinor,
      media: p.media.map((m) => ({ id: m.id, url: m.url, alt: m.alt ?? null, position: m.position })),
      sellerName: p.seller.displayName,
      categorySlug: p.category.slug,
      status: p.status as ProductStatus,
      condition: p.condition as ProductCondition,
      brand: p.brand
        ? { id: p.brand.id, slug: p.brand.slug, name: p.brand.name, logoUrl: p.brand.logoUrl ?? null }
        : null,
      attributes: (p.attributes as Record<string, string>) ?? {},
      variants: p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: v.name,
        priceMinor: v.priceMinor,
        inventoryQty: v.inventoryQty,
        weightGrams: v.weightGrams,
        attributes: (v.attributes as Record<string, string>) ?? {},
      })),
      compliance: {
        requiresAgeCheck: !!p.requiresAgeCheck || (minAge != null && minAge > 0),
        minBuyerAge: minAge,
        blockedCountries: rule?.blockedCountries ?? [],
        allowedCountries: rule?.allowedCountries ?? [],
        requirementKinds: (rule?.requirementKinds ?? []) as ComplianceRequirementKind[],
        isDigital: !!p.isDigital,
        digitalType: (p.digitalProduct?.type as 'LICENSE_KEY' | 'FILE_DOWNLOAD' | undefined) ?? null,
      },
      hsnCode: p.hsnCode ?? null,
      tariffCountry: p.tariffCountry ?? null,
    };
  }
}
