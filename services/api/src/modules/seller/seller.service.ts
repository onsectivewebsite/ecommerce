import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CertificationKind, ProductCondition } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { CreateProductDto, CreateSellerProfileDto } from './dto';
import { ListingFeesService } from '../listing-fees/listing-fees.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { BrandsService } from '../brands/brands.service';
import { SellerCertificationsService } from '../seller-certifications/seller-certifications.service';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

@Injectable()
export class SellerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: ListingFeesService,
    private readonly subs: SubscriptionsService,
    private readonly brands: BrandsService,
    private readonly certs: SellerCertificationsService,
  ) {}

  async createProfile(userId: string, dto: CreateSellerProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const existing = await this.prisma.seller.findUnique({ where: { userId } });
    if (existing) throw new ConflictException('Seller profile already exists');
    const storeSlug = slugify(dto.storeName);
    if (!storeSlug) throw new BadRequestException('Invalid store name');
    const clash = await this.prisma.seller.findUnique({ where: { storeName: storeSlug } });
    if (clash) throw new ConflictException('Store name taken');

    return this.prisma.$transaction(async (tx) => {
      // upgrade user role to SELLER if they were BUYER
      if (user.role === 'BUYER') {
        await tx.user.update({ where: { id: userId }, data: { role: 'SELLER' } });
      }
      return tx.seller.create({
        data: {
          id: newId(),
          userId,
          storeName: storeSlug,
          displayName: dto.displayName,
          payoutCurrency: dto.payoutCurrency,
          status: 'PENDING',
        },
      });
    });
  }

  async getMyProfileOrThrow(userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('No seller profile');
    return seller;
  }

  private async getActiveSellerOrThrow(userId: string) {
    const seller = await this.getMyProfileOrThrow(userId);
    if (seller.status !== 'APPROVED') {
      throw new ForbiddenException('Seller not approved yet');
    }
    return seller;
  }

  async listMyProducts(userId: string, page = 1, pageSize = 20) {
    const seller = await this.getMyProfileOrThrow(userId);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.product.count({ where: { sellerId: seller.id } }),
      this.prisma.product.findMany({
        where: { sellerId: seller.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { media: { orderBy: { position: 'asc' } }, category: true, seller: true },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: items.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        currency: p.currency,
        basePriceMinor: p.basePriceMinor,
        status: p.status,
        sellerName: p.seller.displayName,
        categorySlug: p.category.slug,
        media: p.media.map((m) => ({ id: m.id, url: m.url, alt: m.alt ?? null, position: m.position })),
      })),
    };
  }

  async createProduct(userId: string, dto: CreateProductDto) {
    const seller = await this.getActiveSellerOrThrow(userId);
    // Phase 3: subscription gate on product count.
    await this.subs.requireProductRoom(userId);
    const category = await this.prisma.category.findUnique({ where: { slug: dto.categorySlug } });
    if (!category) throw new BadRequestException('Unknown category');

    const condition = dto.condition ?? ProductCondition.NEW_GENUINE;
    const isRefurb = condition !== ProductCondition.NEW_GENUINE;

    // Phase 14 gates — every listing requires the matching certification, and
    // NEW_GENUINE listings on branded products require brand authorization for
    // the category. No exceptions: drop-shipping and unverified resale are
    // off-limits in the certified-only positioning.
    if (isRefurb) {
      await this.certs.assertHasActive(seller.id, CertificationKind.CERTIFIED_REFURBISHER);
      if ((dto.variants ?? []).length > 0) {
        throw new BadRequestException(
          'Refurb products are published as shells; add per-unit listings via /seller/refurb-units',
        );
      }
    } else {
      // NEW_GENUINE: require AUTHORIZED_RESELLER cert as the base.
      await this.certs.assertHasActive(seller.id, CertificationKind.AUTHORIZED_RESELLER);
      if (!dto.variants || dto.variants.length === 0) {
        throw new BadRequestException('NEW_GENUINE products require at least one variant');
      }
      // Brand authorization is per (seller, brand, category) when a brand is set.
      if (dto.brandId) {
        await this.brands.assertCanPublishNewGenuine(seller.id, dto.brandId, category.slug);
      }
    }

    // If a brand is supplied, validate it exists and the category is allowed.
    if (dto.brandId) {
      const brand = await this.prisma.brand.findUnique({ where: { id: dto.brandId } });
      if (!brand) throw new BadRequestException('Unknown brand');
      if (brand.categorySlugs.length > 0 && !brand.categorySlugs.includes(category.slug)) {
        throw new BadRequestException('Brand does not operate in that category');
      }
    }

    const baseSlug = slugify(dto.title);
    if (!baseSlug) throw new BadRequestException('Invalid title');

    let slug = baseSlug;
    let n = 2;
    while (await this.prisma.product.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${n++}`;
    }

    // Mirror the category compliance "requires age" flag at create time so PDP
    // reads don't need a join. Per-product overrides live alongside.
    const categoryRule = await this.prisma.categoryCompliance.findUnique({
      where: { categoryId: category.id },
    });
    const requiresAge =
      (dto.minBuyerAge != null && dto.minBuyerAge > 0) ||
      (categoryRule?.minBuyerAge != null && categoryRule.minBuyerAge > 0) ||
      !!categoryRule?.requirementKinds?.includes('AGE_GATE');
    const effectiveMinAge = dto.minBuyerAge ?? categoryRule?.minBuyerAge ?? null;

    const created = await this.prisma.product.create({
      data: {
        id: newId(),
        sellerId: seller.id,
        categoryId: category.id,
        brandId: dto.brandId ?? null,
        condition,
        slug,
        title: dto.title,
        description: dto.description,
        currency: dto.currency.toUpperCase(),
        basePriceMinor: dto.basePriceMinor,
        status: dto.status ?? 'ACTIVE',
        attributes: (dto.attributes ?? {}) as object,
        hsnCode: dto.hsnCode ?? null,
        tariffCountry: dto.tariffCountry ? dto.tariffCountry.toUpperCase() : null,
        isDigital: dto.isDigital ?? false,
        requiresAgeCheck: requiresAge,
        minBuyerAge: effectiveMinAge,
        variants: isRefurb
          ? undefined
          : {
              create: (dto.variants ?? []).map((v) => ({
                id: newId(),
                sku: v.sku,
                name: v.name,
                priceMinor: v.priceMinor,
                inventoryQty: v.inventoryQty,
                weightGrams: v.weightGrams,
                attributes: (v.attributes ?? {}) as object,
              })),
            },
        media: dto.mediaUrls?.length
          ? {
              create: dto.mediaUrls.map((url, idx) => ({
                id: newId(),
                url,
                position: idx,
              })),
            }
          : undefined,
      },
      include: { media: true, variants: true, category: true, seller: true },
    });

    // Listings-refactor: auto-create the seller's own ProductListing on
    // their new product so /buybox/:productId returns it immediately.
    await this.prisma.productListing.create({
      data: {
        id: newId(),
        productId: created.id,
        sellerId: seller.id,
        sku: created.slug,
        condition,
        priceMinor: dto.basePriceMinor,
        currency: dto.currency.toUpperCase(),
        status: created.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
        fulfillmentMode: created.fulfillmentMode,
        isBuyBoxWinner: true,
      },
    });

    // Phase 3: charge the resolved listing fee on publish.
    if (created.status === 'ACTIVE') {
      await this.fees.chargeOnPublish(seller.id, created.id, category.id);
    }

    return {
      id: created.id,
      slug: created.slug,
      title: created.title,
      description: created.description,
      currency: created.currency,
      basePriceMinor: created.basePriceMinor,
      media: created.media.map((m) => ({ id: m.id, url: m.url, alt: m.alt ?? null, position: m.position })),
      sellerName: created.seller.displayName,
      categorySlug: created.category.slug,
      status: created.status,
      attributes: created.attributes,
      variants: created.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: v.name,
        priceMinor: v.priceMinor,
        inventoryQty: v.inventoryQty,
        weightGrams: v.weightGrams,
        attributes: v.attributes,
      })),
    };
  }

  async updateVariantInventory(userId: string, variantId: string, inventoryQty: number) {
    const seller = await this.getActiveSellerOrThrow(userId);
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { sellerId: true } } },
    });
    if (!variant || variant.product.sellerId !== seller.id) {
      throw new NotFoundException('Variant not found');
    }
    return this.prisma.productVariant.update({
      where: { id: variantId },
      data: { inventoryQty },
    });
  }

  async listMyOrders(userId: string) {
    const seller = await this.getMyProfileOrThrow(userId);
    return this.prisma.order.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        shippingAddress: true,
        billingAddress: true,
        payment: true,
        seller: true,
      },
    });
  }
}
