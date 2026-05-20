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
import { JwtAuthGuard } from '../auth/jwt.guard';
import { JwtOptionalAuthGuard } from '../auth/jwt-optional.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { ReturnsDispositionService } from './returns-disposition.service';
import { InspectReturnDto, OutletListingsQuery } from './dto';

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('outlet')
@UseGuards(JwtOptionalAuthGuard)
@Controller('outlet')
export class OutletPublicController {
  constructor(private readonly svc: ReturnsDispositionService) {}

  @Get('listings')
  list(@Query() q: OutletListingsQuery, @CurrentUser() u: RequestUser | null) {
    return this.svc.outletListings({
      brand: q.brand,
      condition: q.condition,
      earlyAccess: q.earlyAccess === 'true',
      callerUserId: u?.userId,
    });
  }
}

@ApiTags('warehouse-returns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SHIPPER')
@Controller('warehouse/returns')
export class WarehouseReturnsController {
  constructor(private readonly svc: ReturnsDispositionService) {}

  @Get('queue')
  queue(@Query('warehouseId') warehouseId?: string) {
    return this.svc.pendingQueue(warehouseId);
  }

  @Post('inspect')
  inspect(@CurrentUser() u: RequestUser, @Body() dto: InspectReturnDto, @Req() req: Request) {
    return this.svc.inspect(dto, actor(u, req));
  }
}

@ApiTags('admin-returns-dispositions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/returns')
export class AdminReturnsDispositionController {
  constructor(private readonly svc: ReturnsDispositionService) {}

  @Get('dispositions/pending')
  pending() {
    return this.svc.pendingQueue();
  }

  @Get('dispositions/recent')
  recent(@Query('limit') limit?: string) {
    return this.svc.recentDispositions(limit ? Number(limit) : undefined);
  }
}
