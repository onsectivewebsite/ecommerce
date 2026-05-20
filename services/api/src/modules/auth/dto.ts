import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @ApiProperty() @IsString() @MinLength(1) firstName!: string;
  @ApiProperty() @IsString() @MinLength(1) lastName!: string;
  @ApiProperty({ enum: ['BUYER', 'SELLER'], required: false })
  @IsOptional() @IsEnum(['BUYER', 'SELLER'] as const) role?: 'BUYER' | 'SELLER';
  /** Phase 25: optional referral code captured at signup. */
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(32)
  referralCode?: string;
}

export class LoginDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() password!: string;
}
