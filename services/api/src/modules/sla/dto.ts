import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertSlaProfileDto {
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiProperty() @IsString() @Length(2, 2) country!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) region?: string;
  @ApiProperty() @IsInt() @Min(0) @Max(120) shipDays!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(120) deliveryDays!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class EstimateQuery {
  @ApiProperty() @IsString() productId!: string;
  @ApiProperty() @IsString() @Length(2, 2) country!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) region?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) @Max(50) qty?: number;
}
