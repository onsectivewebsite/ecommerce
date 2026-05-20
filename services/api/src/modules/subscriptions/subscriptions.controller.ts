import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { StartSubscriptionDto } from './dto';

@ApiTags('subscriptions')
@Controller()
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get('subscription-tiers')
  tiers() {
    return this.subs.listTiers();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER', 'ADMIN')
  @Get('seller/subscription')
  myProfile(@CurrentUser() u: RequestUser) {
    return this.subs.getMine(u.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER', 'ADMIN')
  @Post('seller/subscription/start')
  start(@CurrentUser() u: RequestUser, @Body() dto: StartSubscriptionDto) {
    return this.subs.start(u.userId, dto.tier, dto.paymentProvider);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER', 'ADMIN')
  @Post('seller/subscription/cancel')
  cancel(@CurrentUser() u: RequestUser) {
    return this.subs.cancel(u.userId);
  }
}
