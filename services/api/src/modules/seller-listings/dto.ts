import { IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export enum ListingConditionDto {
  NEW_GENUINE = 'NEW_GENUINE',
  REFURB_GRADE_A = 'REFURB_GRADE_A',
  REFURB_GRADE_B = 'REFURB_GRADE_B',
  REFURB_GRADE_C = 'REFURB_GRADE_C',
  OPEN_BOX = 'OPEN_BOX',
}

export enum FulfillmentModeDto {
  SELLER = 'SELLER',
  PLATFORM = 'PLATFORM',
}

export class CreateListingDto {
  @IsString() @Length(1, 80)
  productId!: string;

  @IsString() @Length(1, 80)
  sku!: string;

  @IsEnum(ListingConditionDto)
  condition!: ListingConditionDto;

  @IsInt() @Min(1)
  priceMinor!: number;

  @IsString() @Length(3, 3)
  currency!: string;

  @IsOptional() @IsEnum(FulfillmentModeDto)
  fulfillmentMode?: FulfillmentModeDto;
}

export class UpdateListingDto {
  @IsOptional() @IsString() @Length(1, 80)
  sku?: string;

  @IsOptional() @IsInt() @Min(1)
  priceMinor?: number;

  @IsOptional() @IsEnum(FulfillmentModeDto)
  fulfillmentMode?: FulfillmentModeDto;
}
