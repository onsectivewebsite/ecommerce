import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { DisputeKind, DisputeStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { DisputesService } from './disputes.service';
import { AssignDisputeDto, OpenDisputeDto, ResolveDisputeDto } from './dto';

function actor(u: RequestUser, req: Request) {
  return { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('disputes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post()
  open(@CurrentUser() u: RequestUser, @Body() dto: OpenDisputeDto, @Req() req: Request) {
    return this.disputes.openByBuyer(u.userId, dto, actor(u, req));
  }
}

@ApiTags('admin-disputes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  list(
    @Query('status') status?: DisputeStatus,
    @Query('kind') kind?: DisputeKind,
    @Query('assignedTo') assignedTo?: string,
  ) {
    return this.disputes.listForAdmin(status, kind, assignedTo);
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.disputes.getById(id);
  }

  @Post(':id/assign')
  assign(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: AssignDisputeDto, @Req() req: Request) {
    return this.disputes.assign(id, dto, actor(u, req));
  }

  @Post(':id/resolve')
  resolve(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: ResolveDisputeDto, @Req() req: Request) {
    return this.disputes.resolve(id, dto, actor(u, req));
  }
}
