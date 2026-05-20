import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CheckoutDto {
  @ApiProperty() @IsString() shippingAddressId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() billingAddressId?: string;
  @ApiProperty({ enum: ['mock', 'stripe', 'razorpay', 'paypal'] })
  @IsEnum(['mock', 'stripe', 'razorpay', 'paypal'] as const)
  paymentProvider!: 'mock' | 'stripe' | 'razorpay' | 'paypal';

  // Phase 2: buyer-selected shipping carrier + service-level snapshot.
  @ApiProperty({ required: false }) @IsOptional() @IsString() shippingCarrier?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() shippingService?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) shippingAmountMinor?: number;

  // Phase 10: promo codes + wallet credit applied at checkout.
  @ApiProperty({ required: false, type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true })
  promotionCodes?: string[];

  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0)
  walletAmountMinor?: number;

  /**
   * Phase 24: pay with a saved card. When set, the API resolves the
   * buyer's PaymentMethod and runs Stripe off-session. If SCA is
   * required, the response carries the PaymentIntent clientSecret
   * and the buyer-web completes the step-up inline.
   */
  @ApiProperty({ required: false }) @IsOptional() @IsString() savedPaymentMethodId?: string;
}
