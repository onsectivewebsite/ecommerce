import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { MembershipService } from './membership.service';
import { PointsService } from './points.service';
import { CancelMembershipDto, RedeemPointsDto, SetAutoRenewDto, StartMembershipDto } from './dto';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('loyalty-membership')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('loyalty/membership')
export class LoyaltyMembershipController {
  constructor(private readonly membership: MembershipService) {}

  @Get('me')
  async me(@CurrentUser() u: RequestUser) {
    const row = await this.membership.getForUser(u.userId);
    return {
      membership: row,
      benefits: this.membership.benefits(),
    };
  }

  @Post()
  start(
    @CurrentUser() u: RequestUser,
    @Body() dto: StartMembershipDto,
    @Req() req: Request,
  ) {
    return this.membership.start(u.userId, { plan: dto.plan }, actor(u, req));
  }

  @Post('cancel')
  cancel(
    @CurrentUser() u: RequestUser,
    @Body() dto: CancelMembershipDto,
    @Req() req: Request,
  ) {
    return this.membership.cancel(u.userId, dto.reason, actor(u, req));
  }

  @Post('auto-renew')
  setAutoRenew(
    @CurrentUser() u: RequestUser,
    @Body() dto: SetAutoRenewDto,
    @Req() req: Request,
  ) {
    return this.membership.setAutoRenew(u.userId, dto.autoRenew, actor(u, req));
  }
}

@ApiTags('loyalty-points')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('loyalty/points')
export class LoyaltyPointsController {
  constructor(private readonly points: PointsService) {}

  @Get('balance')
  async balance(@CurrentUser() u: RequestUser) {
    return { balance: await this.points.balance(u.userId) };
  }

  @Get('statement')
  statement(@CurrentUser() u: RequestUser) {
    return this.points.statement(u.userId);
  }

  @Post('redeem')
  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'loyalty.redeem', max: 5, windowSec: 3600, scope: 'user' })
  redeem(@CurrentUser() u: RequestUser, @Body() dto: RedeemPointsDto) {
    return this.points.redeemToWallet(u.userId, dto.points);
  }
}
