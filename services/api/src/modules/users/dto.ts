import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAddressDto {
  @ApiProperty() @IsString() @MaxLength(120) fullName!: string;
  @ApiProperty() @IsString() @MaxLength(200) line1!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) line2?: string;
  @ApiProperty() @IsString() @MaxLength(100) city!: string;
  @ApiProperty() @IsString() @MaxLength(100) region!: string;
  @ApiProperty() @IsString() @MaxLength(20) postalCode!: string;
  @ApiProperty() @IsString() @MaxLength(2) country!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isDefault?: boolean;
}
