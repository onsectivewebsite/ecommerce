import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MembershipBillingEventKind } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { PlusAdminService } from './plus-admin.service';
import { PlusExpiringSoonScheduler } from './plus-expiring-soon.scheduler';

@ApiTags('admin-plus')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/plus')
export class PlusAdminController {
  constructor(
    private readonly svc: PlusAdminService,
    private readonly expiring: PlusExpiringSoonScheduler,
  ) {}

  @Get('stats')
  stats() {
    return this.svc.stats();
  }

  @Get('billing-events')
  events(
    @Query('limit') limit?: string,
    @Query('kind') kind?: MembershipBillingEventKind,
  ) {
    return this.svc.recentBillingEvents(limit ? Number(limit) : 50, kind);
  }

  /** Manual fire of the expiring-soon scan — useful when the scheduler is off in dev. */
  @Post('scan-expiring')
  scanExpiring() {
    return this.expiring.scan();
  }
}
