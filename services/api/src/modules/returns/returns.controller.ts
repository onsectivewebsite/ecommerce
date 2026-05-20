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
import { ReturnsService } from './returns.service';
import { ApproveReturnDto, RejectReturnDto, RequestReturnDto } from './dto';

function actorFromReq(u: RequestUser, req: Request) {
  return { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('returns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('returns')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Post()
  request(@CurrentUser() u: RequestUser, @Body() dto: RequestReturnDto, @Req() req: Request) {
    return this.returns.request(u.userId, dto, actorFromReq(u, req));
  }

  @Get('mine')
  mine(@CurrentUser() u: RequestUser) {
    return this.returns.listForBuyer(u.userId);
  }

  @Delete(':id')
  cancel(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.returns.cancel(u.userId, id, actorFromReq(u, req));
  }

  /**
   * Buyer drops parcel at the carrier — until we wire a real carrier webhook
   * for return-leg tracking, this is the manual confirmation endpoint.
   */
  @Post(':id/dropoff')
  dropoff(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.returns.buyerDropoff(u.userId, id, actorFromReq(u, req));
  }

  /** Presigned (10-min) download URL for the return label PDF. */
  @Get(':id/label')
  async label(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.returns.getLabelUrl(u.userId, id);
  }
}

@ApiTags('seller-returns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/returns')
export class SellerReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  list(@CurrentUser() u: RequestUser) {
    return this.returns.listForSeller(u.userId);
  }

  @Post(':id/approve')
  approve(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: ApproveReturnDto, @Req() req: Request) {
    return this.returns.approve(u.userId, id, dto, actorFromReq(u, req));
  }

  @Post(':id/reject')
  reject(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: RejectReturnDto, @Req() req: Request) {
    return this.returns.reject(u.userId, id, dto, actorFromReq(u, req));
  }

  @Post(':id/received')
  received(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.returns.markReceived(u.userId, id, actorFromReq(u, req));
  }
}

@ApiTags('admin-returns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/returns')
export class AdminReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.returns.adminList(status);
  }

  @Post(':id/force-refund')
  forceRefund(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.returns.adminForceRefund(id, actorFromReq(u, req));
  }
}
