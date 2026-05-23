import { IsEnum, IsInt, IsOptional, IsString, IsUrl, Length, Matches, Min } from 'class-validator';

export enum CollectionStatusDto {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export class CreateCollectionDto {
  @IsString() @Length(2, 80) @Matches(SLUG_RE, { message: 'slug must be lowercase letters, digits, and hyphens' })
  slug!: string;

  @IsString() @Length(2, 120)
  title!: string;

  @IsOptional() @IsString() @Length(0, 1000)
  description?: string;

  @IsOptional() @IsUrl({ require_tld: false })
  heroImageUrl?: string;

  @IsOptional() @IsEnum(CollectionStatusDto)
  status?: CollectionStatusDto;

  @IsOptional() @IsInt() @Min(0)
  position?: number;
}

export class UpdateCollectionDto {
  @IsOptional() @IsString() @Length(2, 80) @Matches(SLUG_RE)
  slug?: string;

  @IsOptional() @IsString() @Length(2, 120)
  title?: string;

  @IsOptional() @IsString() @Length(0, 1000)
  description?: string;

  @IsOptional() @IsUrl({ require_tld: false })
  heroImageUrl?: string;

  @IsOptional() @IsEnum(CollectionStatusDto)
  status?: CollectionStatusDto;

  @IsOptional() @IsInt() @Min(0)
  position?: number;
}

export class AddCollectionItemDto {
  @IsString() @Length(1, 80)
  productId!: string;

  @IsOptional() @IsInt() @Min(0)
  position?: number;
}

export class UpdateCollectionItemDto {
  @IsInt() @Min(0)
  position!: number;
}
