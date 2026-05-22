import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export const AUTOSHIP_INTERVALS = [30, 60, 90];

export class CreateSubscriptionDto {
  @IsString() @Length(1, 80)
  variantId!: string;

  @IsInt() @Min(1) @Max(20)
  qty!: number;

  @IsInt() @IsIn(AUTOSHIP_INTERVALS)
  intervalDays!: number;

  @IsString() @Length(1, 80)
  shippingAddressId!: string;
}

export class UpdateSubscriptionDto {
  @IsOptional() @IsInt() @Min(1) @Max(20)
  qty?: number;

  @IsOptional() @IsInt() @IsIn(AUTOSHIP_INTERVALS)
  intervalDays?: number;

  @IsOptional() @IsString() @Length(1, 80)
  shippingAddressId?: string;
}
