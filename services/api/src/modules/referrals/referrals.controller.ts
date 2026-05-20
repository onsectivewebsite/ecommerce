import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { ReferralsService } from './referrals.service';

@ApiTags('referrals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly svc: ReferralsService) {}

  @Get('me')
  async me(@CurrentUser() u: RequestUser) {
    const [stats, redemptions] = await Promise.all([
      this.svc.myStats(u.userId),
      this.svc.myRedemptions(u.userId),
    ]);
    return { ...stats, redemptions };
  }
}

@ApiTags('admin-referrals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/referrals')
export class AdminReferralsController {
  constructor(private readonly svc: ReferralsService) {}

  @Get('top-inviters')
  topInviters(@Query('days') days?: string) {
    return this.svc.topInviters(days ? Number(days) : 30);
  }

  @Get('abuse-events')
  abuseEvents(@Query('limit') limit?: string) {
    return this.svc.recentAbuseEvents(limit ? Number(limit) : 100);
  }

  @Post(':code/disable')
  disable(@CurrentUser() u: RequestUser, @Param('code') code: string) {
    return this.svc.disable(code, u.userId);
  }
}
