import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { ReturnReason, RefundMethod } from '@onsective/shared-types';

const REASONS: ReturnReason[] = [
  'WRONG_ITEM', 'DAMAGED', 'NOT_AS_DESCRIBED', 'NO_LONGER_NEEDED', 'ARRIVED_LATE', 'OTHER',
];
const METHODS: RefundMethod[] = ['ORIGINAL', 'STORE_CREDIT', 'MANUAL'];

export class ReturnItemInputDto {
  @IsString() @Length(1, 80)
  orderItemId!: string;

  @IsInt() @Min(1)
  qty!: number;
}

export class RequestReturnDto {
  @IsString() @Length(1, 80)
  orderId!: string;

  @IsIn(REASONS)
  reason!: ReturnReason;

  @IsOptional() @IsString() @Length(0, 2000)
  buyerNote?: string;

  /** base64-encoded photo (≤ 4MB). Optional. */
  @IsOptional() @IsString()
  photoBase64?: string;

  @IsOptional() @IsString() @Length(1, 120)
  photoFileName?: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemInputDto)
  items!: ReturnItemInputDto[];
}

export class ApproveReturnDto {
  @IsOptional() @IsString() @Length(0, 2000)
  sellerNote?: string;

  @IsOptional() @IsIn(METHODS)
  refundMethod?: RefundMethod;
}

export class RejectReturnDto {
  @IsString() @Length(1, 2000)
  sellerNote!: string;
}
