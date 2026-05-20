import { Controller, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import type { PaymentProvider } from '@onsective/shared-types';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('mock/capture/:orderId')
  capture(@Param('orderId') orderId: string) {
    return this.payments.captureMock(orderId);
  }

  @Post('webhook/:provider')
  @HttpCode(200)
  webhook(
    @Param('provider') provider: PaymentProvider,
    @Req() req: Request,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return this.payments.handleWebhook(provider, raw, headers);
  }
}
