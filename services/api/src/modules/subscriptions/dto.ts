import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class StartSubscriptionDto {
  @ApiProperty({ enum: ['BASIC', 'PRO', 'ENTERPRISE'] })
  @IsEnum(['BASIC', 'PRO', 'ENTERPRISE'] as const)
  tier!: 'BASIC' | 'PRO' | 'ENTERPRISE';

  @ApiProperty({ enum: ['mock', 'stripe', 'razorpay', 'paypal'] })
  @IsEnum(['mock', 'stripe', 'razorpay', 'paypal'] as const)
  paymentProvider!: 'mock' | 'stripe' | 'razorpay' | 'paypal';
}
