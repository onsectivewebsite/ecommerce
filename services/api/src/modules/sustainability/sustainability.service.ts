import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SustainabilitySubjectKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface UpsertFactorInput {
  categorySlug: string;
  brandId?: string | null;
  kgCo2PerRefurb: number;
  kgMaterialPerRefurb: number;
  lifeExtensionYears: number;
  notes?: string;
}

interface RecordedImpact {
  kgCo2Saved: number;
  kgMaterialDiverted: number;
  lifeExtensionYears: number;
}

@Injectable()
export class SustainabilityService {
  private readonly logger = new Logger(SustainabilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------- factor management ----------------

  listFactors() {
    return this.prisma.sustainabilityFactor.findMany({
      orderBy: [{ categorySlug: 'asc' }, { brandId: 'asc' }],
    });
  }

  async upsertFactor(input: UpsertFactorInput, actor: ActorMeta) {
    if (!input.categorySlug) throw new BadRequestException('categorySlug required');
    const before = await this.prisma.sustainabilityFactor.findUnique({
      where: { categorySlug_brandId: { categorySlug: input.categorySlug, brandId: input.brandId ?? null } },
    }).catch(() => null);
    const row = await this.prisma.sustainabilityFactor.upsert({
      where: {
        categorySlug_brandId: {
          categorySlug: input.categorySlug,
          brandId: input.brandId ?? null,
        },
      },
      create: {
        id: newId(),
        categorySlug: input.categorySlug,
        brandId: input.brandId ?? null,
        kgCo2PerRefurb: input.kgCo2PerRefurb,
        kgMaterialPerRefurb: input.kgMaterialPerRefurb,
        lifeExtensionYears: input.lifeExtensionYears,
        notes: input.notes ?? null,
      },
      update: {
        kgCo2PerRefurb: input.kgCo2PerRefurb,
        kgMaterialPerRefurb: input.kgMaterialPerRefurb,
        lifeExtensionYears: input.lifeExtensionYears,
        notes: input.notes ?? null,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'sustainability.factor.upsert',
      entityType: 'SustainabilityFactor',
      entityId: row.id,
      before, after: row,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return row;
  }

  /**
   * Resolve the active factor: (categorySlug, brandId) match beats
   * (categorySlug) match. Returns null if neither row exists.
   */
  private async resolveFactor(categorySlug: string, brandId: string | null) {
    if (brandId) {
      const specific = await this.prisma.sustainabilityFactor.findUnique({
        where: { categorySlug_brandId: { categorySlug, brandId } },
      });
      if (specific) return specific;
    }
    return this.prisma.sustainabilityFactor.findUnique({
      where: { categorySlug_brandId: { categorySlug, brandId: null } },
    });
  }

  // ---------------- impact recording (idempotent) ----------------

  /**
   * Idempotent write: a duplicate (subjectKind, subjectId) is a no-op.
   * Listener-callers can re-emit the event safely.
   */
  async record(args: {
    subjectKind: SustainabilitySubjectKind;
    subjectId: string;
    buyerUserId?: string | null;
    sellerId?: string | null;
    brandId?: string | null;
    categorySlug: string;
    /** Scale = number of units this event covers (e.g., qty). Default 1. */
    scale?: number;
    /** Optional overrides for trade-in or repair where the formula differs. */
    overrides?: Partial<RecordedImpact>;
    reason?: string;
  }) {
    const existing = await this.prisma.sustainabilityImpact.findUnique({
      where: { subjectKind_subjectId: { subjectKind: args.subjectKind, subjectId: args.subjectId } },
    });
    if (existing) return existing;

    const factor = await this.resolveFactor(args.categorySlug, args.brandId ?? null);
    const scale = args.scale ?? 1;
    const computed: RecordedImpact = {
      kgCo2Saved: (factor?.kgCo2PerRefurb ?? 0) * scale,
      kgMaterialDiverted: (factor?.kgMaterialPerRefurb ?? 0) * scale,
      lifeExtensionYears: factor?.lifeExtensionYears ?? 0,
    };
    const snapshot: RecordedImpact = { ...computed, ...(args.overrides ?? {}) };

    const row = await this.prisma.sustainabilityImpact.create({
      data: {
        id: newId(),
        subjectKind: args.subjectKind,
        subjectId: args.subjectId,
        buyerUserId: args.buyerUserId ?? null,
        sellerId: args.sellerId ?? null,
        brandId: args.brandId ?? null,
        categorySlug: args.categorySlug,
        kgCo2Saved: snapshot.kgCo2Saved,
        kgMaterialDiverted: snapshot.kgMaterialDiverted,
        lifeExtensionYears: snapshot.lifeExtensionYears,
        reason: args.reason ?? null,
      },
    });
    return row;
  }

  // ---------------- aggregate reads ----------------

  async buyerLifetime(userId: string) {
    const [totals, recent] = await Promise.all([
      this.prisma.sustainabilityImpact.aggregate({
        where: { buyerUserId: userId },
        _sum: { kgCo2Saved: true, kgMaterialDiverted: true, lifeExtensionYears: true },
        _count: { _all: true },
      }),
      this.prisma.sustainabilityImpact.findMany({
        where: { buyerUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    return {
      totals: {
        kgCo2Saved: totals._sum.kgCo2Saved ?? 0,
        kgMaterialDiverted: totals._sum.kgMaterialDiverted ?? 0,
        lifeExtensionYears: totals._sum.lifeExtensionYears ?? 0,
        events: totals._count._all,
      },
      recent,
    };
  }

  async brandTotals(brandId: string) {
    const [totals, bySubject] = await Promise.all([
      this.prisma.sustainabilityImpact.aggregate({
        where: { brandId },
        _sum: { kgCo2Saved: true, kgMaterialDiverted: true, lifeExtensionYears: true },
        _count: { _all: true },
      }),
      this.prisma.sustainabilityImpact.groupBy({
        by: ['subjectKind'],
        where: { brandId },
        _sum: { kgCo2Saved: true, kgMaterialDiverted: true },
        _count: { _all: true },
      }),
    ]);
    return {
      totals: {
        kgCo2Saved: totals._sum.kgCo2Saved ?? 0,
        kgMaterialDiverted: totals._sum.kgMaterialDiverted ?? 0,
        lifeExtensionYears: totals._sum.lifeExtensionYears ?? 0,
        events: totals._count._all,
      },
      bySubject: bySubject.map((b) => ({
        subjectKind: b.subjectKind,
        kgCo2Saved: b._sum.kgCo2Saved ?? 0,
        kgMaterialDiverted: b._sum.kgMaterialDiverted ?? 0,
        events: b._count._all,
      })),
    };
  }

  async platformTotals() {
    const [totals, bySubject, topBrands] = await Promise.all([
      this.prisma.sustainabilityImpact.aggregate({
        _sum: { kgCo2Saved: true, kgMaterialDiverted: true, lifeExtensionYears: true },
        _count: { _all: true },
      }),
      this.prisma.sustainabilityImpact.groupBy({
        by: ['subjectKind'],
        _sum: { kgCo2Saved: true, kgMaterialDiverted: true },
        _count: { _all: true },
      }),
      this.prisma.sustainabilityImpact.groupBy({
        by: ['brandId'],
        where: { brandId: { not: null }, createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
        _sum: { kgCo2Saved: true },
        orderBy: { _sum: { kgCo2Saved: 'desc' } },
        take: 5,
      }),
    ]);
    // Hydrate brand names for the top-5 list.
    const brandIds = topBrands.map((b) => b.brandId!).filter(Boolean);
    const brands = brandIds.length > 0
      ? await this.prisma.brand.findMany({
          where: { id: { in: brandIds } },
          select: { id: true, slug: true, name: true, logoUrl: true },
        })
      : [];
    const byId = new Map(brands.map((b) => [b.id, b]));
    return {
      totals: {
        kgCo2Saved: totals._sum.kgCo2Saved ?? 0,
        kgMaterialDiverted: totals._sum.kgMaterialDiverted ?? 0,
        lifeExtensionYears: totals._sum.lifeExtensionYears ?? 0,
        events: totals._count._all,
      },
      bySubject: bySubject.map((b) => ({
        subjectKind: b.subjectKind,
        kgCo2Saved: b._sum.kgCo2Saved ?? 0,
        kgMaterialDiverted: b._sum.kgMaterialDiverted ?? 0,
        events: b._count._all,
      })),
      topBrands90d: topBrands.map((b) => ({
        brandId: b.brandId!,
        kgCo2Saved: b._sum.kgCo2Saved ?? 0,
        brand: byId.get(b.brandId!) ?? null,
      })),
    };
  }
}
