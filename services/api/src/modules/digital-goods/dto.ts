import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  Max,
  ArrayMaxSize,
} from 'class-validator';
import type { DigitalGoodType } from '@onsective/shared-types';

const TYPES: DigitalGoodType[] = ['LICENSE_KEY', 'FILE_DOWNLOAD'];

export class UpsertDigitalProductDto {
  @IsIn(TYPES)
  type!: DigitalGoodType;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  downloadLimit?: number;

  @IsOptional() @IsInt() @Min(1) @Max(3650)
  expiryDays?: number;

  @IsOptional() @IsString() @Length(0, 2000)
  notesToBuyer?: string | null;

  @IsOptional() @IsString()
  fileBase64?: string;

  @IsOptional() @IsString() @Length(0, 200)
  fileName?: string;
}

export class ImportLicenseKeysDto {
  @IsArray() @ArrayMaxSize(5000)
  keys!: string[];
}
