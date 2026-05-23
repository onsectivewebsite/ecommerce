import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import type {
  AddCollectionItemDto,
  CreateCollectionDto,
  UpdateCollectionDto,
  UpdateCollectionItemDto,
} from './dto';

@Injectable()
export class CollectionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- public ----------

  async publicList() {
    const rows = await this.prisma.productCollection.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { items: true } } },
    });
    return rows.map((c) => this.toPublic(c, c._count.items));
  }

  async publicGetBySlug(slug: string) {
    const collection = await this.prisma.productCollection.findUnique({
      where: { slug },
      include: {
        items: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          include: {
            product: {
              include: {
                media: { orderBy: { position: 'asc' }, take: 1 },
                brand: { select: { name: true, slug: true, logoUrl: true } },
                seller: { select: { displayName: true } },
              },
            },
          },
        },
      },
    });
    if (!collection || collection.status !== 'ACTIVE') {
      throw new NotFoundException('Collection not found');
    }
    return {
      ...this.toPublic(collection, collection.items.length),
      products: collection.items
        .filter((it) => it.product.status === 'ACTIVE')
        .map((it) => {
          const p = it.product;
          return {
            id: p.id,
            slug: p.slug,
            title: p.title,
            currency: p.currency,
            basePriceMinor: p.basePriceMinor,
            condition: p.condition,
            sellerName: p.seller.displayName,
            brand: p.brand ? { name: p.brand.name, slug: p.brand.slug, logoUrl: p.brand.logoUrl } : null,
            media: p.media.map((m) => ({ id: m.id, url: m.url, alt: m.alt, position: m.position })),
            position: it.position,
          };
        }),
    };
  }

  // ---------- admin ----------

  async adminList() {
    const rows = await this.prisma.productCollection.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { items: true } } },
    });
    return rows.map((c) => this.toAdmin(c, c._count.items));
  }

  async adminGet(id: string) {
    const collection = await this.prisma.productCollection.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          include: { product: { select: { id: true, slug: true, title: true, status: true } } },
        },
      },
    });
    if (!collection) throw new NotFoundException('Collection not found');
    return {
      ...this.toAdmin(collection, collection.items.length),
      items: collection.items.map((it) => ({
        productId: it.productId,
        position: it.position,
        slug: it.product.slug,
        title: it.product.title,
        status: it.product.status,
      })),
    };
  }

  async create(dto: CreateCollectionDto) {
    const existing = await this.prisma.productCollection.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException('Slug is already in use');
    const row = await this.prisma.productCollection.create({
      data: {
        id: newId(),
        slug: dto.slug,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        heroImageUrl: dto.heroImageUrl ?? null,
        status: dto.status ?? 'DRAFT',
        position: dto.position ?? 0,
      },
    });
    return this.adminGet(row.id);
  }

  async update(id: string, dto: UpdateCollectionDto) {
    const exists = await this.prisma.productCollection.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Collection not found');
    if (dto.slug && dto.slug !== exists.slug) {
      const slugClash = await this.prisma.productCollection.findUnique({ where: { slug: dto.slug } });
      if (slugClash) throw new ConflictException('Slug is already in use');
    }
    await this.prisma.productCollection.update({
      where: { id },
      data: {
        slug: dto.slug ?? undefined,
        title: dto.title?.trim() ?? undefined,
        description: dto.description !== undefined ? (dto.description.trim() || null) : undefined,
        heroImageUrl: dto.heroImageUrl !== undefined ? (dto.heroImageUrl || null) : undefined,
        status: dto.status ?? undefined,
        position: dto.position ?? undefined,
      },
    });
    return this.adminGet(id);
  }

  async remove(id: string) {
    const exists = await this.prisma.productCollection.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Collection not found');
    await this.prisma.productCollection.delete({ where: { id } });
    return { ok: true };
  }

  async addItem(collectionId: string, dto: AddCollectionItemDto) {
    const collection = await this.prisma.productCollection.findUnique({ where: { id: collectionId } });
    if (!collection) throw new NotFoundException('Collection not found');
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new BadRequestException('Product not found');
    await this.prisma.productCollectionItem.upsert({
      where: { collectionId_productId: { collectionId, productId: dto.productId } },
      create: {
        id: newId(),
        collectionId,
        productId: dto.productId,
        position: dto.position ?? 0,
      },
      update: {
        position: dto.position ?? undefined,
      },
    });
    return this.adminGet(collectionId);
  }

  async removeItem(collectionId: string, productId: string) {
    await this.prisma.productCollectionItem.deleteMany({ where: { collectionId, productId } });
    return this.adminGet(collectionId);
  }

  async reorderItem(collectionId: string, productId: string, dto: UpdateCollectionItemDto) {
    const item = await this.prisma.productCollectionItem.findUnique({
      where: { collectionId_productId: { collectionId, productId } },
    });
    if (!item) throw new NotFoundException('Item not found in this collection');
    await this.prisma.productCollectionItem.update({
      where: { id: item.id },
      data: { position: dto.position },
    });
    return this.adminGet(collectionId);
  }

  // ---------- helpers ----------

  private toPublic(
    c: { id: string; slug: string; title: string; description: string | null; heroImageUrl: string | null; position: number; createdAt: Date },
    itemCount: number,
  ) {
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      heroImageUrl: c.heroImageUrl,
      position: c.position,
      itemCount,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private toAdmin(
    c: { id: string; slug: string; title: string; description: string | null; heroImageUrl: string | null; status: string; position: number; createdAt: Date; updatedAt: Date },
    itemCount: number,
  ) {
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      heroImageUrl: c.heroImageUrl,
      status: c.status,
      position: c.position,
      itemCount,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}
