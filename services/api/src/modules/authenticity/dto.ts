import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AuthenticityOutcome } from '@prisma/client';

export class EvidenceItemDto {
  @ApiProperty({ enum: ['PHOTO', 'SERIAL_SCAN', 'HOLOGRAM', 'BOX', 'NOTE'] })
  @IsEnum(['PHOTO', 'SERIAL_SCAN', 'HOLOGRAM', 'BOX', 'NOTE'])
  kind!: 'PHOTO' | 'SERIAL_SCAN' | 'HOLOGRAM' | 'BOX' | 'NOTE';

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) url?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class CreateAuthenticityCheckDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() inboundItemId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() refurbUnitId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(80) serialNumber?: string;

  @ApiProperty({ enum: AuthenticityOutcome })
  @IsEnum(AuthenticityOutcome)
  outcome!: AuthenticityOutcome;

  @ApiProperty({ type: [EvidenceItemDto] })
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => EvidenceItemDto)
  evidence!: EvidenceItemDto[];

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
