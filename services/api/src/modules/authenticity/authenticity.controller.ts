import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthenticityOutcome } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { AuthenticityService } from './authenticity.service';
import { CreateAuthenticityCheckDto } from './dto';

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('warehouse-authenticity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SHIPPER')
@Controller('warehouse/authenticity')
export class WarehouseAuthenticityController {
  constructor(private readonly svc: AuthenticityService) {}

  @Post('checks')
  create(
    @CurrentUser() u: RequestUser,
    @Body() dto: CreateAuthenticityCheckDto,
    @Req() req: Request,
  ) {
    return this.svc.create(dto, actor(u, req));
  }

  @Get('checks')
  list(
    @Query('outcome') outcome?: AuthenticityOutcome,
    @Query('serial') serial?: string,
  ) {
    return this.svc.list({ outcome, serialNumber: serial });
  }
}

@ApiTags('admin-authenticity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/authenticity')
export class AdminAuthenticityController {
  constructor(private readonly svc: AuthenticityService) {}

  @Get('queue')
  queue() {
    return this.svc.pendingReviewQueue();
  }
}
