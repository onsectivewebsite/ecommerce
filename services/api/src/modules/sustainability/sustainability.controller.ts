import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { SustainabilityService } from './sustainability.service';
import { UpsertFactorDto } from './dto';

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('sustainability')
@Controller('sustainability')
export class SustainabilityPublicController {
  constructor(private readonly svc: SustainabilityService) {}

  @Get('platform')
  platform() {
    return this.svc.platformTotals();
  }

  @Get('brands/:brandId')
  brand(@Param('brandId') brandId: string) {
    return this.svc.brandTotals(brandId);
  }
}

@ApiTags('buyer-sustainability')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('account/sustainability')
export class BuyerSustainabilityController {
  constructor(private readonly svc: SustainabilityService) {}

  @Get()
  mine(@CurrentUser() u: RequestUser) {
    return this.svc.buyerLifetime(u.userId);
  }
}

@ApiTags('admin-sustainability')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/sustainability')
export class AdminSustainabilityController {
  constructor(private readonly svc: SustainabilityService) {}

  @Get('factors')
  factors() {
    return this.svc.listFactors();
  }

  @Post('factors')
  upsertFactor(
    @CurrentUser() u: RequestUser,
    @Body() dto: UpsertFactorDto,
    @Req() req: Request,
  ) {
    return this.svc.upsertFactor(dto, actor(u, req));
  }
}
