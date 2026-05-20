import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductCondition } from '@prisma/client';

export class CreateSellerProfileDto {
  @ApiProperty() @IsString() @MaxLength(60) storeName!: string;
  @ApiProperty() @IsString() @MaxLength(120) displayName!: string;
  @ApiProperty({ default: 'USD' }) @IsString() @MaxLength(3) payoutCurrency!: string;
}

export class VariantInputDto {
  @ApiProperty() @IsString() @MaxLength(64) sku!: string;
  @ApiProperty() @IsString() @MaxLength(120) name!: string;
  @ApiProperty() @IsInt() @Min(0) priceMinor!: number;
  @ApiProperty() @IsInt() @Min(0) inventoryQty!: number;
  @ApiProperty() @IsInt() @Min(0) weightGrams!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsObject() attributes?: Record<string, string>;
}

export class CreateProductDto {
  @ApiProperty() @IsString() @MaxLength(200) title!: string;
  @ApiProperty() @IsString() description!: string;
  @ApiProperty() @IsString() categorySlug!: string;
  @ApiProperty() @IsString() @MaxLength(3) currency!: string;
  @ApiProperty() @IsInt() @Min(0) basePriceMinor!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsObject() attributes?: Record<string, string>;

  // For NEW_GENUINE listings at least one variant is required; for
  // REFURB_GRADE_* listings the product is published as a shell and each
  // physical unit is added later via /seller/refurb-units.
  @ApiProperty({ type: [VariantInputDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantInputDto)
  variants?: VariantInputDto[];

  @ApiProperty({ required: false, enum: ProductCondition, default: 'NEW_GENUINE' })
  @IsOptional()
  @IsEnum(ProductCondition)
  condition?: ProductCondition;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];

  @ApiProperty({ enum: ['DRAFT', 'ACTIVE'], default: 'ACTIVE', required: false })
  @IsOptional()
  @IsEnum(['DRAFT', 'ACTIVE'] as const)
  status?: 'DRAFT' | 'ACTIVE';

  // Phase 5: customs + compliance metadata
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(20)
  hsnCode?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2)
  tariffCountry?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsBoolean()
  isDigital?: boolean;

  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) @Max(120)
  minBuyerAge?: number;
}
