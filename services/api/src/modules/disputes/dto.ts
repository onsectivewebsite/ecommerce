import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { DisputeKind } from '@prisma/client';

const DISPUTE_OUTCOMES = {
  RESOLVED_BUYER: 'RESOLVED_BUYER',
  RESOLVED_SELLER: 'RESOLVED_SELLER',
  RESOLVED_SPLIT: 'RESOLVED_SPLIT',
  CLOSED_NO_ACTION: 'CLOSED_NO_ACTION',
} as const;
export type DisputeOutcome = keyof typeof DISPUTE_OUTCOMES;

export class OpenDisputeDto {
  @IsEnum(DisputeKind)
  kind!: DisputeKind;

  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() returnId?: string;
  @IsOptional() @IsString() shipmentId?: string;

  @IsString()
  @MaxLength(2000)
  reason!: string;
}

export class ResolveDisputeDto {
  @IsEnum(DISPUTE_OUTCOMES)
  outcome!: DisputeOutcome;

  @IsString() @MaxLength(2000) note!: string;

  @IsOptional() @IsInt() @Min(0)
  resolutionMinor?: number;
}

export class AssignDisputeDto {
  @IsString() adminUserId!: string;
}
