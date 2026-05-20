import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ApproveSellerDto {
  @ApiProperty({ required: false, description: 'Override commission in basis points (e.g. 1500 = 15%)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  commissionBps?: number;
}

export class RejectSellerDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() reason?: string;
}

export class UpdateSettingDto {
  @ApiProperty() @IsString() key!: string;
  @ApiProperty() @IsString() value!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
}
