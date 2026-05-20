import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class InternalNoteDto {
  @IsString() @MaxLength(4000) body!: string;
}

export class EscalateDto {
  @IsString() @MaxLength(2000) reason!: string;
}

export class PlatformRefundDto {
  @IsInt() @Min(1) amountMinor!: number;
  @IsString() @MaxLength(500) reason!: string;
  /** Set to true to bypass the seller-past-SLA gate (admin override). */
  @IsOptional() override?: boolean;
}
