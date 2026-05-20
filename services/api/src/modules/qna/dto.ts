import { IsString, Length } from 'class-validator';

export class AskQuestionDto {
  @IsString() @Length(1, 80)
  productId!: string;

  @IsString() @Length(5, 1000)
  body!: string;
}

export class AnswerDto {
  @IsString() @Length(1, 4000)
  body!: string;
}

export class AdminHideQnaDto {
  @IsString() @Length(1, 500)
  reason!: string;
}
