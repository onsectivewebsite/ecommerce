import { ApiProperty } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertFactorDto {
  @ApiProperty() @IsString() @Length(1, 80) categorySlug!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() brandId?: string;
  @ApiProperty() @IsNumber() @Min(0) @Max(10000) kgCo2PerRefurb!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(1000) kgMaterialPerRefurb!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(50) lifeExtensionYears!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
