import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class GrantCreditDto {
  @IsString() targetUserId!: string;
  @IsInt() @Min(1) amountMinor!: number;
  @IsOptional() @IsString() currency?: string;
  @IsString() @Length(3, 500) reason!: string;
}

export class ApplyWalletDto {
  @IsInt() @Min(0) amountMinor!: number;
}
