import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import type { CreateListingDto, UpdateListingDto } from './dto';

/**
 * Listings-refactor Step 4: lets an APPROVED seller create a listing on
 * an existing canonical Product, opening the marketplace up to multiple
 * sellers competing on the same item.
 *
 * No certification gates — open seller signup is the Amazon-style stance
 * recorded in [[memory/project_positioning_certified_only.md]].
 */
@Injectable()
export class SellerListingsService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(userId: string) {
    const seller = await this.requireSeller(userId);
    const rows = await this.prisma.productListing.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          select: { id: true, slug: true, title: true, status: true, media: { take: 1, orderBy: { position: 'asc' } } },
        },
      },
      take: 200,
    });
    return rows.map((l) => ({
      id: l.id,
      productId: l.productId,
      productTitle: l.product.title,
      productSlug: l.product.slug,
      productImageUrl: l.product.media[0]?.url ?? null,
      sku: l.sku,
      condition: l.condition,
      priceMinor: l.priceMinor,
      currency: l.currency,
      status: l.status,
      fulfillmentMode: l.fulfillmentMode,
      isBuyBoxWinner: l.isBuyBoxWinner,
      createdAt: l.createdAt.toISOString(),
    }));
  }

  async create(userId: string, dto: CreateListingDto) {
    const seller = await this.requireSeller(userId);
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.status !== 'ACTIVE') throw new BadRequestException('Product is not active');
    const currency = dto.currency.toUpperCase();
    if (product.currency !== currency) {
      throw new BadRequestException(`Currency must match the product (${product.currency})`);
    }
    try {
      const listing = await this.prisma.productListing.create({
        data: {
          id: newId(),
          productId: product.id,
          sellerId: seller.id,
          sku: dto.sku.trim(),
          condition: dto.condition,
          priceMinor: dto.priceMinor,
          currency,
          status: 'ACTIVE',
          fulfillmentMode: dto.fulfillmentMode ?? 'SELLER',
          // Buy Box recompute will pick the real winner across competing
          // listings in Step 5; default true here is a placeholder.
          isBuyBoxWinner: false,
        },
      });
      return this.listMine(userId).then((all) => all.find((l) => l.id === listing.id)!);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          if ((e.meta?.target as string[] | undefined)?.includes('sku')) {
            throw new ConflictException('You already have another listing with that SKU');
          }
          throw new ConflictException('You already have a listing on this product with this condition');
        }
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdateListingDto) {
    const seller = await this.requireSeller(userId);
    const listing = await this.prisma.productListing.findUnique({ where: { id } });
    if (!listing || listing.sellerId !== seller.id) throw new NotFoundException('Listing not found');
    try {
      await this.prisma.productListing.update({
        where: { id },
        data: {
          sku: dto.sku?.trim() ?? undefined,
          priceMinor: dto.priceMinor ?? undefined,
          fulfillmentMode: dto.fulfillmentMode ?? undefined,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Another listing of yours already has that SKU');
      }
      throw e;
    }
    return this.listMine(userId).then((all) => all.find((l) => l.id === id)!);
  }

  async deactivate(userId: string, id: string) {
    return this.setStatus(userId, id, 'INACTIVE');
  }
  async reactivate(userId: string, id: string) {
    return this.setStatus(userId, id, 'ACTIVE');
  }

  private async setStatus(userId: string, id: string, status: 'ACTIVE' | 'INACTIVE') {
    const seller = await this.requireSeller(userId);
    const listing = await this.prisma.productListing.findUnique({ where: { id } });
    if (!listing || listing.sellerId !== seller.id) throw new NotFoundException('Listing not found');
    await this.prisma.productListing.update({ where: { id }, data: { status } });
    return this.listMine(userId).then((all) => all.find((l) => l.id === id)!);
  }

  private async requireSeller(userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new ForbiddenException('Seller profile required');
    if (seller.status !== 'APPROVED') {
      throw new ForbiddenException('Seller account is not approved');
    }
    return seller;
  }
}
