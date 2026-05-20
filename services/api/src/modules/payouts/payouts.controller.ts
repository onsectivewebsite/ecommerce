import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { PayoutStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { PayoutsService } from './payouts.service';
import { MarkPaidDto } from './dto';

@ApiTags('payouts')
@Controller()
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  // ----- Admin -----

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('admin/payouts')
  list(@Query('status') status?: PayoutStatus) {
    return this.payouts.list(status);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/payouts/run')
  run() {
    return this.payouts.runForPeriod();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/payouts/:id/execute')
  execute(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.payouts.execute(id, { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/payouts/:id/mark-paid')
  markPaid(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: MarkPaidDto, @Req() req: Request) {
    return this.payouts.markPaid(id, dto.externalRef, { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  // ----- Seller -----

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER', 'ADMIN')
  @Get('seller/payouts')
  mine(@CurrentUser() u: RequestUser) {
    return this.payouts.listForSeller(u.userId);
  }
}
