import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TradeInGrade, TradeInPayoutMethod } from '@prisma/client';

export class CreateTradeInModelDto {
  @ApiProperty() @IsString() sourceProductId!: string;
  @ApiProperty() @IsString() destinationProductId!: string;
  @ApiProperty() @IsInt() @Min(1) baseOfferMinor!: number;
  @ApiProperty() @IsString() @Length(3, 3) currency!: string;
  @ApiProperty() @IsObject() gradeMultipliers!: Record<TradeInGrade, number>;
  @ApiProperty({ type: [Object] })
  @IsArray()
  accessoryAdjustments!: Array<{ key: string; amountMinor: number; label?: string }>;
  @ApiProperty({ required: false }) @IsOptional() @IsString() assignedRefurbiserId?: string;
}

export class QuoteRequestDto {
  @ApiProperty() @IsString() productSlug!: string;
  @ApiProperty({ enum: TradeInGrade }) @IsEnum(TradeInGrade) declaredGrade!: TradeInGrade;
  @ApiProperty({ type: [String] })
  @IsArray() @IsString({ each: true })
  accessories!: string[];
}

export class AcceptQuoteDto {
  @ApiProperty() @IsString() quoteId!: string;
  @ApiProperty() @IsInt() @Min(1) offerMinor!: number;
  @ApiProperty() @IsString() @Length(3, 3) currency!: string;
  @ApiProperty() @IsString() expiresAt!: string;
  @ApiProperty() @IsString() signature!: string;
  @ApiProperty() @IsString() modelId!: string;
  @ApiProperty({ enum: TradeInGrade }) @IsEnum(TradeInGrade) declaredGrade!: TradeInGrade;
  @ApiProperty({ type: [String] })
  @IsArray() @IsString({ each: true })
  accessories!: string[];
  @ApiProperty({ required: false, enum: TradeInPayoutMethod })
  @IsOptional() @IsEnum(TradeInPayoutMethod)
  payoutMethod?: TradeInPayoutMethod;
}

export class IntakeDto {
  @ApiProperty() @IsString() orderId!: string;
  @ApiProperty({ type: [String] })
  @IsArray() @IsString({ each: true })
  photoUrls!: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000)
  conditionNotes?: string;
}

export class GradingDto {
  @ApiProperty() @IsString() orderId!: string;
  @ApiProperty({ enum: TradeInGrade }) @IsEnum(TradeInGrade) actualGrade!: TradeInGrade;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  evidenceUrls?: string[];
}
