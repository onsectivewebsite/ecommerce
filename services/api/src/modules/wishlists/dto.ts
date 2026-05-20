import { IsOptional, IsString, Length } from 'class-validator';

export class AddWishlistItemDto {
  @IsString() productId!: string;
}

export class RenameWishlistDto {
  @IsString() @Length(1, 80) name!: string;
}

export class ShareTokenDto {
  @IsOptional() @IsString() token?: string;
}
