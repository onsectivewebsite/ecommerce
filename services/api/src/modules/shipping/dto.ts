import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const CARRIER_CODES = ['mock', 'fedex', 'ups', 'dhl', 'canadapost'] as const;

export class ShippingRuleDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsInt() @Min(0) priority!: number;
  @ApiProperty() @IsInt() @Min(0) minWeightGrams!: number;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() @Min(0) maxWeightGrams?: number | null;
  @ApiProperty({ required: false, type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) destinationCountries?: string[];
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() flatRateMinor?: number | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() freeAboveMinor?: number | null;
  @ApiProperty({ required: false, type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) carrierCodeWhitelist?: string[];
  @ApiProperty({ required: false }) @IsOptional() enabled?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() currency?: string;
}

export class QuoteRequestDto {
  @ApiProperty() @IsString() shippingAddressId!: string;
}

export class MilestoneDto {
  @ApiProperty({ enum: ['picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception'] })
  @IsEnum(['picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception'] as const)
  code!: 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception';
  @ApiProperty() @IsString() label!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() locationCity?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() locationCountry?: string;
}

export class CarrierConfigDto {
  @ApiProperty({ enum: CARRIER_CODES }) @IsEnum(CARRIER_CODES) carrierCode!: typeof CARRIER_CODES[number];
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() accountNumber?: string;
  @ApiProperty({ required: false, type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) serviceLevels?: string[];
}

export class CarrierConfigUpdateDto {
  @ApiProperty({ type: [CarrierConfigDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => CarrierConfigDto)
  carriers!: CarrierConfigDto[];
}
