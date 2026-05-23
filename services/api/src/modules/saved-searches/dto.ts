import { IsOptional, IsString, Length } from 'class-validator';

export class CreateSavedSearchDto {
  @IsString() @Length(2, 200)
  q!: string;

  @IsOptional() @IsString() @Length(1, 80)
  name?: string;
}
