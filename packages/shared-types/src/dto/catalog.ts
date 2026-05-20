import type { CurrencyCode } from '../money';
import type { ProductStatus } from '../enums';
import type { ProductComplianceSummaryDto } from './compliance';

export interface CategoryDto {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  position: number;
}

export interface MediaDto {
  id: string;
  url: string;
  alt?: string | null;
  position: number;
}

export interface ProductVariantDto {
  id: string;
  sku: string;
  name: string;
  priceMinor: number;
  inventoryQty: number;
  weightGrams: number;
  attributes: Record<string, string>;
}

export type ProductCondition =
  | 'NEW_GENUINE'
  | 'REFURB_GRADE_A'
  | 'REFURB_GRADE_B'
  | 'REFURB_GRADE_C'
  | 'OPEN_BOX';

export interface BrandSummaryDto {
  id: string;
  slug: string;
  name: string;
  logoUrl?: string | null;
}

export interface ProductSummaryDto {
  id: string;
  slug: string;
  title: string;
  currency: CurrencyCode;
  basePriceMinor: number;
  media: MediaDto[];
  sellerName: string;
  categorySlug: string;
  status: ProductStatus;
  condition?: ProductCondition;
  brand?: BrandSummaryDto | null;
}

export interface ProductDetailDto extends ProductSummaryDto {
  description: string;
  variants: ProductVariantDto[];
  attributes: Record<string, string>;
  compliance?: ProductComplianceSummaryDto;
  hsnCode?: string | null;
  tariffCountry?: string | null;
}

export interface PaginatedProducts {
  items: ProductSummaryDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateProductRequest {
  title: string;
  description: string;
  categorySlug: string;
  currency: CurrencyCode;
  basePriceMinor: number;
  attributes?: Record<string, string>;
  variants: Array<{
    sku: string;
    name: string;
    priceMinor: number;
    inventoryQty: number;
    weightGrams: number;
    attributes?: Record<string, string>;
  }>;
  mediaUrls?: string[];
  status?: ProductStatus;
  // Phase 5
  hsnCode?: string;
  tariffCountry?: string;
  isDigital?: boolean;
  minBuyerAge?: number;
}
