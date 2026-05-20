import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

const PRICING = ['CPC', 'CPM'] as const;
const STATUS  = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED', 'EXHAUSTED'] as const;
const PLACEMENT = ['SPONSORED_PRODUCT', 'SEARCH_SPONSOR', 'BANNER_SLOT'] as const;

export class CreateCampaignDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: PRICING }) @IsEnum(PRICING) pricingModel!: typeof PRICING[number];
  @ApiProperty() @IsInt() @Min(0) bidMinor!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() currency?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) dailyBudgetMinor?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) totalBudgetMinor?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) priority?: number;
}

export class UpdateCampaignDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false, enum: STATUS }) @IsOptional() @IsEnum(STATUS) status?: typeof STATUS[number];
  @ApiProperty({ required: false, enum: PRICING }) @IsOptional() @IsEnum(PRICING) pricingModel?: typeof PRICING[number];
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) bidMinor?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) dailyBudgetMinor?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) totalBudgetMinor?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) priority?: number;
}

export class AddPlacementDto {
  @ApiProperty({ enum: PLACEMENT }) @IsEnum(PLACEMENT) type!: typeof PLACEMENT[number];
  @ApiProperty({ required: false }) @IsOptional() @IsString() productId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() assetId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() searchKeyword?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() categorySlug?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) weight?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() destinationUrl?: string;
}

export class TopUpDto {
  @ApiProperty() @IsInt() @Min(100) amountMinor!: number;
  @ApiProperty({ enum: ['mock', 'stripe'] }) @IsEnum(['mock', 'stripe'] as const) paymentProvider!: 'mock' | 'stripe';
}

export class ImpressionDto {
  @ApiProperty() @IsString() campaignId!: string;
  @ApiProperty() @IsString() placementId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() buyerSessionId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() eventKey?: string;
}
