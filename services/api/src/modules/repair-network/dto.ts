import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { RepairPartnerStatus, ServiceTicketStatus } from '@prisma/client';

export class CreatePartnerDto {
  @ApiProperty() @IsString() userId!: string;
  @ApiProperty() @IsString() @Length(2, 120) displayName!: string;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  capabilityCategorySlugs?: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) dailyCapacity?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) turnaroundHours?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) serviceLine1?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(120) serviceCity?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(60) serviceRegion?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(20) servicePostal?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(2, 2) serviceCountry?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdatePartnerDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(2, 120) displayName?: string;
  @ApiProperty({ required: false, enum: RepairPartnerStatus })
  @IsOptional() @IsEnum(RepairPartnerStatus) status?: RepairPartnerStatus;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  capabilityCategorySlugs?: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) dailyCapacity?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) turnaroundHours?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class AdminAssignPartnerDto {
  @ApiProperty() @IsString() partnerId!: string;
}

export class UpdateTicketDto {
  @ApiProperty({ required: false, enum: ServiceTicketStatus })
  @IsOptional() @IsEnum(ServiceTicketStatus) status?: ServiceTicketStatus;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000) partnerNote?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) estimatedPartsCostMinor?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(80) inboundCarrier?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(120) inboundTracking?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(80) outboundCarrier?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(120) outboundTracking?: string;
}

export class CancelTicketDto {
  @ApiProperty() @IsString() @MaxLength(1000) reason!: string;
}
