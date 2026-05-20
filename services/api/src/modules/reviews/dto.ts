import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateReviewDto {
  @IsString() @Length(1, 80)
  orderItemId!: string;

  @IsInt() @Min(1) @Max(5)
  rating!: number;

  @IsOptional() @IsString() @Length(0, 120)
  title?: string;

  @IsString() @Length(1, 4000)
  body!: string;
}

export class SellerReplyDto {
  @IsString() @Length(1, 2000)
  reply!: string;
}

export class AdminHideDto {
  @IsString() @Length(1, 500)
  reason!: string;
}
