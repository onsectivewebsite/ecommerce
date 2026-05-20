import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface CreateBrandInput {
  slug: string;
  name: string;
  logoUrl?: string;
  contactEmail?: string;
  categorySlugs?: string[];
}

export interface UpdateBrandInput {
  name?: string;
  logoUrl?: string | null;
  contactEmail?: string | null;
  categorySlugs?: string[];
}

export interface AuthorizeSellerInput {
  sellerId: string;
  brandId: string;
  categorySlug: string;
  expiresAt: string; // ISO date
  documentUrl?: string;
  note?: string;
}

function normSlug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.brand.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true, authorizations: true } } },
    });
  }

  listPublic() {
    return this.prisma.brand.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, logoUrl: true, categorySlugs: true },
    });
  }

  async getBySlug(slug: string) {
    const brand = await this.prisma.brand.findUnique({ where: { slug } });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  async create(input: CreateBrandInput, actor: ActorMeta) {
    const slug = normSlug(input.slug);
    if (!slug) throw new BadRequestException('Invalid slug');
    const dup = await this.prisma.brand.findUnique({ where: { slug } });
    if (dup) throw new ConflictException('Brand slug already exists');
    const created = await this.prisma.brand.create({
      data: {
        id: newId(),
        slug,
        name: input.name,
        logoUrl: input.logoUrl ?? null,
        contactEmail: input.contactEmail ?? null,
        categorySlugs: (input.categorySlugs ?? []).map((s) => normSlug(s)).filter(Boolean),
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'brand.create',
      entityType: 'Brand',
      entityId: created.id,
      after: { slug: created.slug, name: created.name },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return created;
  }

  async update(id: string, patch: UpdateBrandInput, actor: ActorMeta) {
    const before = await this.prisma.brand.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Brand not found');
    const updated = await this.prisma.brand.update({
      where: { id },
      data: {
        name: patch.name ?? undefined,
        logoUrl: patch.logoUrl === undefined ? undefined : patch.logoUrl,
        contactEmail: patch.contactEmail === undefined ? undefined : patch.contactEmail,
        categorySlugs:
          patch.categorySlugs === undefined
            ? undefined
            : patch.categorySlugs.map((s) => normSlug(s)).filter(Boolean),
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'brand.update',
      entityType: 'Brand',
      entityId: id,
      before,
      after: updated,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  }

  listAuthorizations(brandId?: string, sellerId?: string) {
    return this.prisma.brandAuthorization.findMany({
      where: { brandId, sellerId },
      orderBy: { expiresAt: 'desc' },
      include: {
        brand: { select: { id: true, slug: true, name: true } },
        seller: { select: { id: true, storeName: true, displayName: true } },
      },
    });
  }

  async authorize(input: AuthorizeSellerInput, actor: ActorMeta) {
    const brand = await this.prisma.brand.findUnique({ where: { id: input.brandId } });
    if (!brand) throw new NotFoundException('Brand not found');
    const seller = await this.prisma.seller.findUnique({ where: { id: input.sellerId } });
    if (!seller) throw new NotFoundException('Seller not found');
    const categorySlug = normSlug(input.categorySlug);
    if (!categorySlug) throw new BadRequestException('Invalid category slug');
    if (brand.categorySlugs.length > 0 && !brand.categorySlugs.includes(categorySlug)) {
      throw new BadRequestException('Brand does not operate in that category');
    }
    const expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('expiresAt must be a future date');
    }

    const upserted = await this.prisma.brandAuthorization.upsert({
      where: {
        sellerId_brandId_categorySlug: {
          sellerId: input.sellerId,
          brandId: input.brandId,
          categorySlug,
        },
      },
      create: {
        id: newId(),
        sellerId: input.sellerId,
        brandId: input.brandId,
        categorySlug,
        expiresAt,
        documentUrl: input.documentUrl ?? null,
        note: input.note ?? null,
      },
      update: {
        expiresAt,
        documentUrl: input.documentUrl ?? null,
        note: input.note ?? null,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'brand.authorize',
      entityType: 'BrandAuthorization',
      entityId: upserted.id,
      after: { sellerId: input.sellerId, brandId: input.brandId, categorySlug, expiresAt },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return upserted;
  }

  async revokeAuthorization(authId: string, actor: ActorMeta) {
    const auth = await this.prisma.brandAuthorization.findUnique({ where: { id: authId } });
    if (!auth) throw new NotFoundException('Authorization not found');
    await this.prisma.brandAuthorization.delete({ where: { id: authId } });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'brand.authorize.revoke',
      entityType: 'BrandAuthorization',
      entityId: authId,
      before: auth,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { ok: true };
  }

  /**
   * Returns the active authorization row (or null). Used by publish gate.
   * "Active" = exists AND expiresAt > now.
   */
  async findActiveAuthorization(sellerId: string, brandId: string, categorySlug: string) {
    const auth = await this.prisma.brandAuthorization.findUnique({
      where: {
        sellerId_brandId_categorySlug: {
          sellerId,
          brandId,
          categorySlug: normSlug(categorySlug),
        },
      },
    });
    if (!auth) return null;
    if (auth.expiresAt.getTime() <= Date.now()) return null;
    return auth;
  }

  /**
   * Publish gate. Brand may be null (no-name commodity), in which case
   * brand authorization is skipped. Caller is responsible for the base
   * seller-certification check (handled in SellerCertificationsService).
   */
  async assertCanPublishNewGenuine(
    sellerId: string,
    brandId: string | null,
    categorySlug: string,
  ) {
    if (!brandId) return; // unbranded white-label items still need cert, checked elsewhere
    // Phase 17: an inventory-holding brand-seller is implicitly authorized
    // for any category the brand operates in — no separate authorization row.
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (brand?.sellerId === sellerId) return;
    const auth = await this.findActiveAuthorization(sellerId, brandId, categorySlug);
    if (!auth) {
      throw new BadRequestException(
        'Seller is not authorized to sell this brand in this category. Brand authorization required.',
      );
    }
  }

  // ============================================================================
  // Phase 17 — Brand Storefronts
  // ============================================================================

  async updateStorefront(
    id: string,
    patch: {
      mode?: 'INVENTORY_HOLDING' | 'AUTHORIZED_ONLY';
      heroMediaUrl?: string | null;
      heroHeadline?: string | null;
      heroSubcopy?: string | null;
      story?: string | null;
      accentColor?: string | null;
      isPublished?: boolean;
    },
    actor: ActorMeta,
  ) {
    const before = await this.prisma.brand.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Brand not found');
    if (patch.isPublished && !before.sellerId && patch.mode === 'INVENTORY_HOLDING') {
      throw new BadRequestException('Cannot publish an INVENTORY_HOLDING brand without a paired seller');
    }
    const updated = await this.prisma.brand.update({
      where: { id },
      data: {
        mode: patch.mode ?? undefined,
        heroMediaUrl: patch.heroMediaUrl === undefined ? undefined : patch.heroMediaUrl,
        heroHeadline: patch.heroHeadline === undefined ? undefined : patch.heroHeadline,
        heroSubcopy: patch.heroSubcopy === undefined ? undefined : patch.heroSubcopy,
        story: patch.story === undefined ? undefined : patch.story,
        accentColor: patch.accentColor === undefined ? undefined : patch.accentColor,
        isPublished: patch.isPublished ?? undefined,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'brand.storefront.update',
      entityType: 'Brand',
      entityId: id,
      before,
      after: updated,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  }

  /**
   * Promote a brand to INVENTORY_HOLDING by attaching a Seller. Either an
   * existing `sellerId` or a `{ storeName, displayName }` shorthand that
   * creates the seller anchored to an admin user (same pattern as Phase 15
   * house-seller bootstrap).
   *
   * Also issues a long-lived AUTHORIZED_RESELLER cert so the brand-seller
   * can publish NEW_GENUINE listings under the brand immediately.
   */
  async attachSeller(
    brandId: string,
    input: { sellerId?: string; storeName?: string; displayName?: string },
    actor: ActorMeta,
  ) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new NotFoundException('Brand not found');
    if (brand.sellerId) throw new ConflictException('Brand already has a paired seller');

    let sellerId = input.sellerId;
    if (!sellerId) {
      if (!input.storeName || !input.displayName) {
        throw new BadRequestException('sellerId or { storeName, displayName } required');
      }
      const storeName = normSlug(input.storeName);
      const dup = await this.prisma.seller.findUnique({ where: { storeName } });
      if (dup) throw new ConflictException('storeName already in use');
      const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' } });
      if (!admin) throw new BadRequestException('No admin user to anchor the brand-seller');
      const created = await this.prisma.seller.create({
        data: {
          id: newId(),
          userId: admin.id,
          storeName,
          displayName: input.displayName,
          status: 'APPROVED',
          payoutCurrency: 'USD',
        },
      });
      sellerId = created.id;
    } else {
      const exists = await this.prisma.seller.findUnique({ where: { id: sellerId } });
      if (!exists) throw new BadRequestException('Seller not found');
    }

    const fiveYears = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000);
    await this.prisma.sellerCertification.upsert({
      where: { sellerId_kind: { sellerId, kind: 'AUTHORIZED_RESELLER' } },
      create: {
        id: newId(),
        sellerId,
        kind: 'AUTHORIZED_RESELLER',
        status: 'ACTIVE',
        documents: [{ url: '', label: 'Brand-seller automatic certification' }] as object,
        applicantNote: `Auto-issued via brand attach for ${brand.slug}`,
        reviewedBy: actor.userId,
        reviewedAt: new Date(),
        expiresAt: fiveYears,
      },
      update: {
        status: 'ACTIVE',
        expiresAt: fiveYears,
        reviewedBy: actor.userId,
        reviewedAt: new Date(),
      },
    });

    const updated = await this.prisma.brand.update({
      where: { id: brandId },
      data: { sellerId, mode: 'INVENTORY_HOLDING' },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'brand.seller.attach',
      entityType: 'Brand',
      entityId: brandId,
      after: { sellerId, mode: 'INVENTORY_HOLDING' },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  }

  // ---- collections ----

  async createCollection(brandId: string, input: { slug: string; title: string; subtitle?: string; position?: number }, actor: ActorMeta) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new NotFoundException('Brand not found');
    const slug = normSlug(input.slug);
    if (!slug) throw new BadRequestException('Invalid slug');
    const dup = await this.prisma.brandCollection.findUnique({
      where: { brandId_slug: { brandId, slug } },
    });
    if (dup) throw new ConflictException('Collection slug already exists for this brand');
    const created = await this.prisma.brandCollection.create({
      data: {
        id: newId(),
        brandId,
        slug,
        title: input.title,
        subtitle: input.subtitle ?? null,
        position: input.position ?? 0,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'brand.collection.create',
      entityType: 'BrandCollection',
      entityId: created.id,
      after: { brandId, slug },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return created;
  }

  async setCollectionProducts(collectionId: string, productIds: string[], actor: ActorMeta) {
    const coll = await this.prisma.brandCollection.findUnique({ where: { id: collectionId } });
    if (!coll) throw new NotFoundException('Collection not found');
    await this.prisma.$transaction([
      this.prisma.brandCollectionProduct.deleteMany({ where: { collectionId } }),
      this.prisma.brandCollectionProduct.createMany({
        data: productIds.map((productId, idx) => ({
          id: newId(),
          collectionId,
          productId,
          position: idx,
        })),
      }),
    ]);
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'brand.collection.products.set',
      entityType: 'BrandCollection',
      entityId: collectionId,
      after: { count: productIds.length },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.prisma.brandCollection.findUnique({
      where: { id: collectionId },
      include: { products: { orderBy: { position: 'asc' } } },
    });
  }

  async deleteCollection(collectionId: string, actor: ActorMeta) {
    const coll = await this.prisma.brandCollection.findUnique({ where: { id: collectionId } });
    if (!coll) throw new NotFoundException('Collection not found');
    await this.prisma.brandCollection.delete({ where: { id: collectionId } });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'brand.collection.delete',
      entityType: 'BrandCollection',
      entityId: collectionId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { ok: true };
  }

  /** Admin view: collections + their pinned products + product metadata. */
  listCollections(brandId: string) {
    return this.prisma.brandCollection.findMany({
      where: { brandId },
      orderBy: { position: 'asc' },
      include: {
        products: {
          orderBy: { position: 'asc' },
          include: {
            product: {
              select: { id: true, slug: true, title: true, status: true, sellerId: true, condition: true },
            },
          },
        },
      },
    });
  }

  // ---- public storefront ----

  /**
   * Public storefront read. Returns 404-equivalent (null) when not
   * published. Hydrates collections + filters their pinned products to
   * those whose seller currently satisfies the publish gate.
   */
  async storefront(slug: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { slug },
      include: {
        seller: { select: { id: true, displayName: true, storeName: true } },
        collections: {
          orderBy: { position: 'asc' },
          include: {
            products: {
              orderBy: { position: 'asc' },
              include: {
                product: {
                  include: {
                    media: { orderBy: { position: 'asc' }, take: 1 },
                    seller: { select: { id: true, displayName: true } },
                    category: { select: { slug: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!brand || !brand.isPublished) return null;

    // Pre-resolve which sellers currently satisfy the publish gate for this
    // brand. A seller satisfies it if they ARE the brand-seller, or they
    // hold an active authorization for the brand+category of the product.
    const filteredCollections = await Promise.all(
      brand.collections.map(async (c) => {
        const products = await this.filterProducts(brand, c.products.map((p) => p.product));
        return {
          id: c.id,
          slug: c.slug,
          title: c.title,
          subtitle: c.subtitle,
          position: c.position,
          products,
        };
      }),
    );

    // All live products attached to the brand (for the "all products" grid).
    const allProducts = await this.prisma.product.findMany({
      where: { brandId: brand.id, status: 'ACTIVE' },
      include: {
        media: { orderBy: { position: 'asc' }, take: 1 },
        seller: { select: { id: true, displayName: true } },
        category: { select: { slug: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    const liveProducts = await this.filterProducts(brand, allProducts);

    return {
      id: brand.id,
      slug: brand.slug,
      name: brand.name,
      logoUrl: brand.logoUrl,
      mode: brand.mode,
      heroMediaUrl: brand.heroMediaUrl,
      heroHeadline: brand.heroHeadline,
      heroSubcopy: brand.heroSubcopy,
      story: brand.story,
      accentColor: brand.accentColor,
      sellerId: brand.sellerId,
      sellerName: brand.seller?.displayName ?? null,
      collections: filteredCollections,
      liveProducts,
    };
  }

  /**
   * Apply the publish-gate filter to a list of products. Single source of
   * truth — never duplicates the gate logic.
   */
  private async filterProducts(
    brand: { id: string; sellerId: string | null },
    products: Array<{
      id: string; slug: string; title: string; status: string; sellerId: string;
      brandId: string | null; categoryId: string; currency: string; basePriceMinor: number;
      condition: string;
      media: Array<{ id: string; url: string; alt: string | null; position: number }>;
      seller: { id: string; displayName: string };
      category: { slug: string };
    }>,
  ) {
    if (products.length === 0) return [];
    // Bulk-load authorizations for the sellers we see, scoped to this brand.
    const sellerIds = [...new Set(products.map((p) => p.sellerId))];
    const auths = await this.prisma.brandAuthorization.findMany({
      where: { brandId: brand.id, sellerId: { in: sellerIds } },
    });
    const now = Date.now();
    const allowed = new Set<string>();
    for (const a of auths) {
      if (a.expiresAt.getTime() > now) allowed.add(`${a.sellerId}:${a.categorySlug}`);
    }
    return products
      .filter((p) => {
        if (p.status !== 'ACTIVE') return false;
        // Brand-seller is implicitly authorized for any category.
        if (brand.sellerId && p.sellerId === brand.sellerId) return true;
        return allowed.has(`${p.sellerId}:${p.category.slug}`);
      })
      .map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        currency: p.currency,
        basePriceMinor: p.basePriceMinor,
        media: p.media,
        sellerName: p.seller.displayName,
        categorySlug: p.category.slug,
        status: p.status,
        condition: p.condition,
      }));
  }
}
