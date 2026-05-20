import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { SellerWebhooksService } from './seller-webhooks.service';
import { CreateEndpointDto, UpdateEndpointDto } from './dto';

function actor(u: RequestUser, req: Request) {
  return { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('seller-webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/webhooks')
export class SellerWebhooksController {
  constructor(private readonly hooks: SellerWebhooksService) {}

  @Get()
  list(@CurrentUser() u: RequestUser) {
    return this.hooks.list(u.userId);
  }

  @Post()
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateEndpointDto, @Req() req: Request) {
    return this.hooks.create(u.userId, dto, actor(u, req));
  }

  @Patch(':id')
  update(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: UpdateEndpointDto, @Req() req: Request) {
    return this.hooks.update(u.userId, id, dto, actor(u, req));
  }

  @Post(':id/rotate')
  rotate(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.hooks.rotateSecret(u.userId, id, actor(u, req));
  }

  @Delete(':id')
  remove(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.hooks.remove(u.userId, id, actor(u, req));
  }

  @Get(':id/deliveries')
  deliveries(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.hooks.listDeliveries(u.userId, id);
  }
}
