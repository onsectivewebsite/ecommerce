import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import type {
  CategoryComplianceDto,
  ComplianceRequirementKind,
} from '@onsective/shared-types';
import type { UpsertCategoryComplianceDto } from './dto';

function normCountry(c: string): string {
  return c.trim().toUpperCase().slice(0, 2);
}

@Injectable()
export class CategoryRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<CategoryComplianceDto[]> {
    const cats = await this.prisma.category.findMany({
      include: { compliance: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    return cats
      .filter((c) => c.compliance)
      .map((c) => this.toDto(c.compliance!, c));
  }

  async getByCategorySlug(slug: string): Promise<CategoryComplianceDto | null> {
    const cat = await this.prisma.category.findUnique({
      where: { slug },
      include: { compliance: true },
    });
    if (!cat || !cat.compliance) return null;
    return this.toDto(cat.compliance, cat);
  }

  async getByCategoryId(categoryId: string): Promise<CategoryComplianceDto | null> {
    const cat = await this.prisma.category.findUnique({
      where: { id: categoryId },
      include: { compliance: true },
    });
    if (!cat) throw new NotFoundException('Category not found');
    if (!cat.compliance) return null;
    return this.toDto(cat.compliance, cat);
  }

  async upsert(categoryId: string, dto: UpsertCategoryComplianceDto): Promise<CategoryComplianceDto> {
    const cat = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!cat) throw new NotFoundException('Category not found');

    const kinds = (dto.requirementKinds ?? []) as ComplianceRequirementKind[];
    if (dto.minBuyerAge != null && (dto.minBuyerAge < 0 || dto.minBuyerAge > 120)) {
      throw new BadRequestException('minBuyerAge out of range');
    }
    const blocked = (dto.blockedCountries ?? []).map(normCountry).filter((c) => c.length === 2);
    const allowed = (dto.allowedCountries ?? []).map(normCountry).filter((c) => c.length === 2);

    const data = {
      minBuyerAge: dto.minBuyerAge ?? null,
      requiresSellerDoc: dto.requiresSellerDoc ?? false,
      requirementKinds: kinds,
      blockedCountries: blocked,
      allowedCountries: allowed,
      notes: dto.notes ?? null,
    };

    const row = await this.prisma.categoryCompliance.upsert({
      where: { categoryId },
      create: { id: newId(), categoryId, ...data },
      update: data,
    });

    // Propagate to products so PDP can be served without a join.
    await this.propagateToProducts(categoryId, row.minBuyerAge, kinds);

    return this.toDto(row, cat);
  }

  async delete(categoryId: string): Promise<void> {
    await this.prisma.categoryCompliance.delete({ where: { categoryId } }).catch(() => undefined);
    await this.propagateToProducts(categoryId, null, []);
  }

  private async propagateToProducts(
    categoryId: string,
    minBuyerAge: number | null,
    kinds: ComplianceRequirementKind[],
  ) {
    const requiresAge = kinds.includes('AGE_GATE') || (minBuyerAge != null && minBuyerAge > 0);
    // Only sync the boolean fast-path flag. The PDP/checkout reads the live `category.compliance.minBuyerAge`
    // via a join, and per-product `minBuyerAge` is reserved for explicit seller overrides — we never
    // overwrite it here.
    await this.prisma.product.updateMany({
      where: { categoryId },
      data: { requiresAgeCheck: requiresAge },
    });
  }

  private toDto(row: any, cat: any): CategoryComplianceDto {
    return {
      id: row.id,
      categoryId: row.categoryId,
      categorySlug: cat.slug,
      categoryName: cat.name,
      minBuyerAge: row.minBuyerAge ?? null,
      requiresSellerDoc: row.requiresSellerDoc,
      requirementKinds: row.requirementKinds as ComplianceRequirementKind[],
      blockedCountries: row.blockedCountries ?? [],
      allowedCountries: row.allowedCountries ?? [],
      notes: row.notes ?? null,
    };
  }
}
