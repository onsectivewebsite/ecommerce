import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { PromotionKind, PromotionScope, PromotionStatus } from '@prisma/client';

export class CreatePromotionDto {
  @IsString() @Length(3, 40) @Matches(/^[A-Z0-9_-]+$/)
  code!: string;

  @IsEnum(PromotionKind) kind!: PromotionKind;
  @IsEnum(PromotionScope) scope!: PromotionScope;

  @IsInt() @Min(0) valueBpOrMinor!: number;

  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() @Min(0) minSubtotalMinor?: number;

  @IsOptional() @IsInt() @Min(1) bogoBuyQty?: number;
  @IsOptional() @IsInt() @Min(1) bogoGetQty?: number;
  @IsOptional() @IsInt() @Min(0) bogoGetDiscountBp?: number;

  @IsOptional() @IsInt() @Min(1) perUserLimit?: number;
  @IsOptional() @IsInt() @Min(1) totalLimit?: number;

  @IsOptional() startsAt?: string;
  @IsOptional() endsAt?: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(500)
  productIds?: string[];
}

export class UpdatePromotionDto {
  @IsOptional() @IsEnum(PromotionStatus) status?: PromotionStatus;
  @IsOptional() @IsInt() @Min(0) valueBpOrMinor?: number;
  @IsOptional() @IsInt() @Min(0) minSubtotalMinor?: number;
  @IsOptional() @IsInt() @Min(1) perUserLimit?: number;
  @IsOptional() @IsInt() @Min(1) totalLimit?: number;
  @IsOptional() startsAt?: string;
  @IsOptional() endsAt?: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}

export class ApplyPromotionDto {
  @IsString() @Length(3, 40)
  code!: string;
}
