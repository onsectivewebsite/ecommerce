import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CertificationKind, CertificationStatus } from '@prisma/client';

export class CertificationDocumentDto {
  @ApiProperty() @IsString() @MaxLength(500) url!: string;
  @ApiProperty() @IsString() @MaxLength(120) label!: string;
}

export class ApplyCertificationDto {
  @ApiProperty({ enum: CertificationKind })
  @IsEnum(CertificationKind)
  kind!: CertificationKind;

  @ApiProperty({ type: [CertificationDocumentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CertificationDocumentDto)
  documents!: CertificationDocumentDto[];

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000)
  applicantNote?: string;
}

export class ReviewCertificationDto {
  @ApiProperty() @IsBoolean() approve!: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000)
  reviewNote?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1)
  validForMonths?: number;
}

export class RevokeCertificationDto {
  @ApiProperty() @IsString() @MaxLength(2000) reason!: string;
}

export class ListCertificationsQuery {
  @ApiProperty({ required: false, enum: CertificationStatus })
  @IsOptional()
  @IsEnum(CertificationStatus)
  status?: CertificationStatus;

  @ApiProperty({ required: false }) @IsOptional() @IsString() sellerId?: string;
}
