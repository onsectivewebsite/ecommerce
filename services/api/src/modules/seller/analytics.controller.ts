import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { AnalyticsService } from './analytics.service';

type Range = '7d' | '30d' | '90d';
function parseRange(q?: string): Range {
  return q === '7d' || q === '90d' ? q : '30d';
}

@ApiTags('seller-analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  summary(@CurrentUser() u: RequestUser, @Query('range') range?: string) {
    return this.analytics.summary(u.userId, parseRange(range));
  }

  @Get('top-skus')
  topSkus(@CurrentUser() u: RequestUser, @Query('range') range?: string, @Query('limit') limit?: string) {
    return this.analytics.topSkus(u.userId, parseRange(range), limit ? Number(limit) : 10);
  }
}
