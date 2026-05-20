import {
  Body,
  Controller,
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
import { SellerCertificationsService } from './seller-certifications.service';
import {
  ApplyCertificationDto,
  ListCertificationsQuery,
  ReviewCertificationDto,
  RevokeCertificationDto,
} from './dto';

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('seller-certifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
@Controller('seller/certifications')
export class SellerCertificationsSellerController {
  constructor(private readonly svc: SellerCertificationsService) {}

  @Get()
  mine(@CurrentUser() u: RequestUser) {
    return this.svc.listMine(u.userId);
  }

  @Post()
  apply(
    @CurrentUser() u: RequestUser,
    @Body() dto: ApplyCertificationDto,
    @Req() req: Request,
  ) {
    return this.svc.apply(u.userId, dto, actor(u, req));
  }
}

@ApiTags('admin-certifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/certifications')
export class AdminCertificationsController {
  constructor(private readonly svc: SellerCertificationsService) {}

  @Get('pending')
  pending() {
    return this.svc.listPending();
  }

  @Get()
  list(@Query() q: ListCertificationsQuery) {
    return this.svc.listAll({ status: q.status, sellerId: q.sellerId });
  }

  @Post(':id/review')
  review(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReviewCertificationDto,
    @Req() req: Request,
  ) {
    return this.svc.review(id, dto, actor(u, req));
  }

  @Post(':id/revoke')
  revoke(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: RevokeCertificationDto,
    @Req() req: Request,
  ) {
    return this.svc.revoke(id, dto.reason, actor(u, req));
  }
}
