import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { RefurbUnitsService } from './refurb-units.service';
import { CreateRefurbUnitDto, UpdateRefurbUnitDto } from './dto';

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('refurb-units')
@Controller('refurb-units')
export class RefurbUnitsPublicController {
  constructor(private readonly svc: RefurbUnitsService) {}

  @Get('by-product/:productId')
  forProduct(@Param('productId') productId: string) {
    return this.svc.listAvailableForProduct(productId);
  }

  @Get('lookup')
  lookup(@Query('serial') serial: string) {
    if (!serial) return null;
    return this.svc.lookupBySerial(serial);
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.svc.getPublic(id);
  }
}

@ApiTags('seller-refurb-units')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
@Controller('seller/refurb-units')
export class SellerRefurbUnitsController {
  constructor(private readonly svc: RefurbUnitsService) {}

  @Get()
  mine(@CurrentUser() u: RequestUser) {
    return this.svc.listForSeller(u.userId);
  }

  @Post()
  create(
    @CurrentUser() u: RequestUser,
    @Body() dto: CreateRefurbUnitDto,
    @Req() req: Request,
  ) {
    return this.svc.create(u.userId, dto, actor(u, req));
  }

  @Patch(':id')
  update(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateRefurbUnitDto,
    @Req() req: Request,
  ) {
    return this.svc.update(u.userId, id, dto, actor(u, req));
  }
}
