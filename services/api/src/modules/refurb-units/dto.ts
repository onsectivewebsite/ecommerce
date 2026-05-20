import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class CreateRefurbUnitDto {
  @ApiProperty() @IsString() productId!: string;
  @ApiProperty() @IsString() @Length(2, 80) serialNumber!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(8, 24) imei?: string;
  @ApiProperty() @IsInt() @Min(0) priceMinor!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() warehouseId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsObject() conditionReport?: Record<string, unknown>;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  unitPhotoMediaIds?: string[];
}

export class UpdateRefurbUnitDto {
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) priceMinor?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsObject() conditionReport?: Record<string, unknown>;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  unitPhotoMediaIds?: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsString() warehouseId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() withdraw?: boolean;
}
