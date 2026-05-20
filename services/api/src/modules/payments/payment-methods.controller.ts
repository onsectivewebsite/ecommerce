import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { PaymentMethodsService } from './payment-methods.service';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';

class AttachPaymentMethodDto {
  @IsString() @Length(5, 200) setupIntentId!: string;
}

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('payment-methods')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly svc: PaymentMethodsService) {}

  @Get()
  list(@CurrentUser() u: RequestUser) {
    return this.svc.list(u.userId);
  }

  @Post('setup-intent')
  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'payment-methods.setup-intent', max: 10, windowSec: 3600, scope: 'user' })
  setupIntent(@CurrentUser() u: RequestUser) {
    return this.svc.createSetupIntent(u.userId);
  }

  @Post('attach')
  attach(
    @CurrentUser() u: RequestUser,
    @Body() dto: AttachPaymentMethodDto,
    @Req() req: Request,
  ) {
    return this.svc.attachConfirmed(u.userId, dto.setupIntentId, actor(u, req));
  }

  @Post(':id/default')
  setDefault(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.svc.setDefault(u.userId, id, actor(u, req));
  }

  @Delete(':id')
  detach(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.svc.detach(u.userId, id, actor(u, req));
  }
}
