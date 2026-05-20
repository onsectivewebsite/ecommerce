import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { WarrantyClaimStatus } from '@prisma/client';

export class WarrantyEvidenceDto {
  @ApiProperty({ enum: ['PHOTO', 'VIDEO', 'NOTE'] })
  @IsEnum(['PHOTO', 'VIDEO', 'NOTE'])
  kind!: 'PHOTO' | 'VIDEO' | 'NOTE';
  @ApiProperty() @IsString() @MaxLength(500) url!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class FileWarrantyClaimDto {
  @ApiProperty() @IsString() orderItemId!: string;
  @ApiProperty() @IsString() @Length(10, 2000) symptom!: string;

  @ApiProperty({ type: [WarrantyEvidenceDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WarrantyEvidenceDto)
  evidence!: WarrantyEvidenceDto[];
}

export class ApproveWarrantyClaimDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

const RESOLUTION_STATUSES = [
  WarrantyClaimStatus.RESOLVED_REPAIR,
  WarrantyClaimStatus.RESOLVED_REPLACE,
  WarrantyClaimStatus.RESOLVED_REFUND,
  WarrantyClaimStatus.REJECTED,
] as const;

export class ResolveWarrantyClaimDto {
  @ApiProperty({ enum: RESOLUTION_STATUSES })
  @IsEnum(RESOLUTION_STATUSES)
  status!: (typeof RESOLUTION_STATUSES)[number];

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000) resolutionNote?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() replacementRefurbUnitId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) refundAmountMinor?: number;
}
