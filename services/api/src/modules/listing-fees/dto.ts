import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateListingFeeRuleDto {
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() sellerId?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() categoryId?: string | null;
  @ApiProperty() @IsInt() @Min(0) amountMinor!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() currency?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() note?: string;
}

export class UpdateListingFeeRuleDto {
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() sellerId?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() categoryId?: string | null;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) amountMinor?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() currency?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() note?: string;
}
