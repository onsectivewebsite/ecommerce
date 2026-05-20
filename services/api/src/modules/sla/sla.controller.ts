import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { SlaService } from './sla.service';
import { EstimateQuery, UpsertSlaProfileDto } from './dto';

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('sla')
@Controller('sla')
export class SlaPublicController {
  constructor(private readonly svc: SlaService) {}

  @Get('estimate')
  estimate(@Query() q: EstimateQuery) {
    return this.svc.estimateForBuyer({
      productId: q.productId,
      country: q.country,
      region: q.region ?? null,
      qty: q.qty,
    });
  }
}

@ApiTags('admin-sla')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/sla')
export class AdminSlaController {
  constructor(private readonly svc: SlaService) {}

  @Get('profiles')
  profiles(@Query('warehouseId') warehouseId?: string) {
    return this.svc.listProfiles(warehouseId);
  }

  @Post('profiles')
  upsertProfile(@CurrentUser() u: RequestUser, @Body() dto: UpsertSlaProfileDto, @Req() req: Request) {
    return this.svc.upsertProfile(dto, actor(u, req));
  }

  @Delete('profiles/:id')
  deleteProfile(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.svc.deleteProfile(id, actor(u, req));
  }

  @Get('breaches')
  breaches(@Query('limit') limit?: string) {
    return this.svc.recentBreaches(limit ? Number(limit) : undefined);
  }

  @Post('scan')
  scan() {
    return this.svc.scanBreaches();
  }
}
