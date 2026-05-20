import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBooleanString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ProductCondition, ReturnDisposition } from '@prisma/client';

export class InspectReturnDto {
  @ApiProperty() @IsString() returnId!: string;
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiProperty({ enum: ReturnDisposition }) @IsEnum(ReturnDisposition) disposition!: ReturnDisposition;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000) conditionNotes?: string;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  photoUrls?: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) @Max(5000)
  outletDiscountBps?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1000)
  disposeReason?: string;
}

export class OutletListingsQuery {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(1, 80) brand?: string;
  @ApiProperty({ required: false, enum: ProductCondition })
  @IsOptional() @IsEnum(ProductCondition)
  condition?: ProductCondition;
  /** Honored only when the caller is an ACTIVE Plus member. */
  @ApiProperty({ required: false }) @IsOptional() @IsBooleanString() earlyAccess?: string;
}
