import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { MembershipPlan } from '@prisma/client';

export class StartMembershipDto {
  @IsEnum(MembershipPlan) plan!: MembershipPlan;
}

export class CancelMembershipDto {
  @IsOptional() @IsString() @Length(1, 500) reason?: string;
}

export class SetAutoRenewDto {
  @IsBoolean() autoRenew!: boolean;
}

export class RedeemPointsDto {
  @IsInt() @Min(100) points!: number;
}
