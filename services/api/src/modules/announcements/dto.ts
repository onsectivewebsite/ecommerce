import { IsBoolean, IsEnum, IsISO8601, IsOptional, IsString, IsUrl, Length } from 'class-validator';

export enum AnnouncementLevelDto {
  INFO = 'INFO',
  SUCCESS = 'SUCCESS',
  WARNING = 'WARNING',
}

export class CreateAnnouncementDto {
  @IsString() @Length(1, 200)
  title!: string;

  @IsString() @Length(1, 1000)
  message!: string;

  @IsOptional() @IsEnum(AnnouncementLevelDto)
  level?: AnnouncementLevelDto;

  @IsOptional() @IsUrl({ require_tld: false })
  linkUrl?: string;

  @IsOptional() @IsString() @Length(1, 80)
  linkLabel?: string;

  @IsISO8601()
  startsAt!: string;

  @IsOptional() @IsISO8601()
  endsAt?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UpdateAnnouncementDto {
  @IsOptional() @IsString() @Length(1, 200)
  title?: string;

  @IsOptional() @IsString() @Length(1, 1000)
  message?: string;

  @IsOptional() @IsEnum(AnnouncementLevelDto)
  level?: AnnouncementLevelDto;

  @IsOptional() @IsUrl({ require_tld: false })
  linkUrl?: string;

  @IsOptional() @IsString() @Length(1, 80)
  linkLabel?: string;

  @IsOptional() @IsISO8601()
  startsAt?: string;

  @IsOptional() @IsISO8601()
  endsAt?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
