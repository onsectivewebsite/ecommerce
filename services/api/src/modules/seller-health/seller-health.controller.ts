import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { SellerHealthService } from './seller-health.service';

@ApiTags('seller-health')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/health')
export class SellerHealthController {
  constructor(private readonly health: SellerHealthService) {}

  @Get()
  mine(@CurrentUser() u: RequestUser) {
    return this.health.sellerOverview(u.userId);
  }
}

@ApiTags('admin-seller-health')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/seller-health')
export class AdminSellerHealthController {
  constructor(private readonly health: SellerHealthService) {}

  @Get()
  list(@Query('maxScore') maxScore?: string) {
    return this.health.adminList(maxScore ? Number(maxScore) : undefined);
  }
}
