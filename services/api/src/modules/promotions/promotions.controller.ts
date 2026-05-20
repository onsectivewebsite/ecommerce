import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { PromotionScope } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { PromotionsService } from './promotions.service';
import { CreatePromotionDto, UpdatePromotionDto } from './dto';

function actor(u: RequestUser, req: Request) {
  return { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('seller-promotions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/promotions')
export class SellerPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  list(@CurrentUser() u: RequestUser) {
    return this.promotions.listForSeller(u.userId);
  }

  @Post()
  create(@CurrentUser() u: RequestUser, @Body() dto: CreatePromotionDto, @Req() req: Request) {
    return this.promotions.createForSeller(u.userId, dto, actor(u, req));
  }

  @Patch(':id')
  update(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: UpdatePromotionDto, @Req() req: Request) {
    return this.promotions.update(id, u.userId, dto, actor(u, req));
  }
}

@ApiTags('admin-promotions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/promotions')
export class AdminPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  list(@Query('scope') scope?: PromotionScope) {
    return this.promotions.listForAdmin(scope);
  }

  @Post()
  create(@CurrentUser() u: RequestUser, @Body() dto: CreatePromotionDto, @Req() req: Request) {
    return this.promotions.createForAdmin(dto, actor(u, req));
  }

  @Patch(':id')
  update(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: UpdatePromotionDto, @Req() req: Request) {
    return this.promotions.update(id, null, dto, actor(u, req));
  }
}
