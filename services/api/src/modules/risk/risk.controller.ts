import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { IsString, Length } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { RiskService } from './risk.service';

class ReviewDto {
  @IsString() @Length(1, 500) note!: string;
}

function actor(u: RequestUser, req: Request) {
  return { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('admin-risk')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/risk')
export class AdminRiskController {
  constructor(private readonly risk: RiskService) {}

  @Get('queue')
  queue() {
    return this.risk.openHolds();
  }

  @Get('orders/:id')
  assessment(@Param('id') orderId: string) {
    return this.risk.getOrderAssessment(orderId);
  }

  @Post('orders/:id/release')
  release(@CurrentUser() u: RequestUser, @Param('id') orderId: string, @Body() dto: ReviewDto, @Req() req: Request) {
    return this.risk.release(orderId, dto.note, actor(u, req));
  }

  @Post('orders/:id/cancel')
  cancel(@CurrentUser() u: RequestUser, @Param('id') orderId: string, @Body() dto: ReviewDto, @Req() req: Request) {
    return this.risk.cancel(orderId, dto.note, actor(u, req));
  }
}
