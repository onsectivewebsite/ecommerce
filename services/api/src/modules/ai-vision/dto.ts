import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AiModelKind } from '@prisma/client';

export class SuggestInputDto {
  @ApiProperty({ enum: ['refurbUnit', 'inboundItem', 'tradeInOrder'] })
  @IsEnum(['refurbUnit', 'inboundItem', 'tradeInOrder'])
  inputRefKind!: 'refurbUnit' | 'inboundItem' | 'tradeInOrder';

  @ApiProperty() @IsString() inputRefId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(80) serialNumber?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() productSlug?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() brandSlug?: string;
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) mediaUrls!: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

export class RegisterModelDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string;
  @ApiProperty({ enum: AiModelKind }) @IsEnum(AiModelKind) kind!: AiModelKind;
  @ApiProperty() @IsString() @Length(1, 32) version!: string;
  @ApiProperty() @IsString() providerKind!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(1) thresholdConfidence?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class SetModelActiveDto {
  @ApiProperty() isActive!: boolean;
}

export class SetThresholdDto {
  @ApiProperty() @IsNumber() @Min(0) @Max(1) thresholdConfidence!: number;
}
