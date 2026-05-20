import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { BrandMode } from '@prisma/client';

export class CreateBrandDto {
  @ApiProperty() @IsString() @Length(2, 80) slug!: string;
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsEmail() contactEmail?: string;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categorySlugs?: string[];
}

export class UpdateBrandDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(2, 120) name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsEmail() contactEmail?: string;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categorySlugs?: string[];
}

export class AuthorizeSellerDto {
  @ApiProperty() @IsString() sellerId!: string;
  @ApiProperty() @IsString() brandId!: string;
  @ApiProperty() @IsString() @Length(1, 120) categorySlug!: string;
  @ApiProperty() @IsDateString() expiresAt!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) documentUrl?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class UpdateStorefrontDto {
  @ApiProperty({ required: false, enum: BrandMode })
  @IsOptional() @IsEnum(BrandMode) mode?: BrandMode;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) heroMediaUrl?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) heroHeadline?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) heroSubcopy?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(20000) story?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(16) accentColor?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class AttachSellerDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() sellerId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(2, 80) storeName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(2, 120) displayName?: string;
}

export class CreateCollectionDto {
  @ApiProperty() @IsString() @Length(2, 80) slug!: string;
  @ApiProperty() @IsString() @Length(2, 120) title!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) subtitle?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) position?: number;
}

export class SetCollectionProductsDto {
  @ApiProperty({ type: [String] })
  @IsArray() @IsString({ each: true })
  productIds!: string[];
}
