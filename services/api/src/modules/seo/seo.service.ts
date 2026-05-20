import { Injectable } from '@nestjs/common';
import { RefurbUnitAvailability } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface SlugEntry {
  slug: string;
  updatedAt: Date;
}

const CHUNK_SIZE = 5000;

@Injectable()
export class SeoService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- product slugs (chunked) ----------------

  /**
   * Returns the chunk-N batch of ACTIVE product slugs ordered by id ASC.
   * Chunks are 5,000 URLs each — well below the 50k sitemap cap. We use
   * id-keyset pagination because product status doesn't change order.
   */
  async productSlugChunk(chunkIndex: number): Promise<SlugEntry[]> {
    if (chunkIndex < 0) return [];
    const skip = chunkIndex * CHUNK_SIZE;
    const rows = await this.prisma.product.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { id: 'asc' },
      skip,
      take: CHUNK_SIZE,
      select: { slug: true, updatedAt: true },
    });
    return rows;
  }

  async productChunkCount(): Promise<number> {
    const total = await this.prisma.product.count({ where: { status: 'ACTIVE' } });
    return Math.max(1, Math.ceil(total / CHUNK_SIZE));
  }

  async productsLastModified(): Promise<Date | null> {
    const row = await this.prisma.product.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    return row?.updatedAt ?? null;
  }

  // ---------------- brand slugs ----------------

  async brandSlugs(): Promise<SlugEntry[]> {
    return this.prisma.brand.findMany({
      where: { isPublished: true },
      orderBy: { slug: 'asc' },
      select: { slug: true, updatedAt: true },
    });
  }

  async brandsLastModified(): Promise<Date | null> {
    const row = await this.prisma.brand.findFirst({
      where: { isPublished: true },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    return row?.updatedAt ?? null;
  }

  // ---------------- category slugs ----------------

  async categorySlugs(): Promise<SlugEntry[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: { slug: 'asc' },
      select: { slug: true, createdAt: true },
    });
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.createdAt }));
  }

  async categoriesLastModified(): Promise<Date | null> {
    const row = await this.prisma.category.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }

  // ---------------- outlet ----------------

  /**
   * Outlet sitemap: products that have at least one AVAILABLE RefurbUnit.
   * Smaller list, kept in one file.
   */
  async outletProductSlugs(): Promise<SlugEntry[]> {
    const rows = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        refurbUnits: { some: { availability: RefurbUnitAvailability.AVAILABLE } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
      select: { slug: true, updatedAt: true },
    });
    return rows;
  }

  async outletLastModified(): Promise<Date | null> {
    const row = await this.prisma.product.findFirst({
      where: {
        status: 'ACTIVE',
        refurbUnits: { some: { availability: RefurbUnitAvailability.AVAILABLE } },
      },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    return row?.updatedAt ?? null;
  }
}
