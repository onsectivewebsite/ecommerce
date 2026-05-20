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
import { WarrantyService } from './warranty.service';
import {
  ApproveWarrantyClaimDto,
  FileWarrantyClaimDto,
  ResolveWarrantyClaimDto,
} from './dto';

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('warranty')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('warranty/claims')
export class WarrantyBuyerController {
  constructor(private readonly svc: WarrantyService) {}

  @Get()
  mine(@CurrentUser() u: RequestUser) {
    return this.svc.listForBuyer(u.userId);
  }

  @Post()
  file(
    @CurrentUser() u: RequestUser,
    @Body() dto: FileWarrantyClaimDto,
    @Req() req: Request,
  ) {
    return this.svc.file(u.userId, dto, actor(u, req));
  }
}

@ApiTags('admin-warranty')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/warranty')
export class AdminWarrantyController {
  constructor(private readonly svc: WarrantyService) {}

  @Get('queue')
  queue() {
    return this.svc.listOpen();
  }

  @Post(':id/approve')
  approve(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: ApproveWarrantyClaimDto,
    @Req() req: Request,
  ) {
    return this.svc.approve(id, dto.note, actor(u, req));
  }

  @Post(':id/resolve')
  resolve(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: ResolveWarrantyClaimDto,
    @Req() req: Request,
  ) {
    return this.svc.resolve(id, dto, actor(u, req));
  }
}
