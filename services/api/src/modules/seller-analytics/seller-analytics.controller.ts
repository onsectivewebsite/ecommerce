import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { SellerAnalyticsService } from './seller-analytics.service';

@ApiTags('seller-analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/analytics')
export class SellerAnalyticsController {
  constructor(private readonly analytics: SellerAnalyticsService) {}

  @Get('overview')
  overview(@CurrentUser() u: RequestUser, @Query('days') days?: string) {
    const window = days ? Math.min(180, Math.max(7, Number(days))) : 30;
    return this.analytics.sellerOverview(u.userId, window);
  }
}
