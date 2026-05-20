import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class MarkPaidDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() externalRef?: string;
}
