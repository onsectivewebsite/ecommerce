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
import { RepairNetworkService } from './repair-network.service';
import {
  AdminAssignPartnerDto,
  CancelTicketDto,
  CreatePartnerDto,
  UpdatePartnerDto,
  UpdateTicketDto,
} from './dto';

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('admin-repair-network')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/repair-network')
export class AdminRepairNetworkController {
  constructor(private readonly svc: RepairNetworkService) {}

  @Get('partners')
  partners() {
    return this.svc.listPartners();
  }

  @Post('partners')
  createPartner(@CurrentUser() u: RequestUser, @Body() dto: CreatePartnerDto, @Req() req: Request) {
    return this.svc.createPartner(dto, actor(u, req));
  }

  @Patch('partners/:id')
  updatePartner(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePartnerDto,
    @Req() req: Request,
  ) {
    return this.svc.updatePartner(id, dto, actor(u, req));
  }

  @Get('tickets')
  tickets(@Query('limit') limit?: string) {
    return this.svc.adminListTickets(limit ? Number(limit) : undefined);
  }

  @Get('tickets/unassigned')
  unassigned() {
    return this.svc.adminUnassigned();
  }

  @Post('tickets/:id/assign')
  assign(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: AdminAssignPartnerDto,
    @Req() req: Request,
  ) {
    return this.svc.adminAssignPartner(id, dto.partnerId, actor(u, req));
  }

  @Patch('tickets/:id')
  adminUpdateTicket(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
    @Req() req: Request,
  ) {
    return this.svc.adminUpdateTicket(id, dto, actor(u, req));
  }

  @Post('tickets/:id/cancel')
  cancel(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: CancelTicketDto,
    @Req() req: Request,
  ) {
    return this.svc.cancel(id, dto.reason, actor(u, req));
  }
}

@ApiTags('partner-repair')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('partner/repair')
export class PartnerRepairController {
  constructor(private readonly svc: RepairNetworkService) {}

  @Get('tickets')
  myTickets(@CurrentUser() u: RequestUser) {
    return this.svc.partnerQueue(u.userId);
  }

  @Post('tickets/:id/update')
  update(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
    @Req() req: Request,
  ) {
    return this.svc.partnerUpdateTicket(u.userId, id, dto, actor(u, req));
  }
}

@ApiTags('buyer-repair')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('warranty/claims')
export class BuyerRepairController {
  constructor(private readonly svc: RepairNetworkService) {}

  @Get(':claimId/repair-ticket')
  ticket(@Param('claimId') claimId: string) {
    return this.svc.ticketForClaim(claimId);
  }
}
