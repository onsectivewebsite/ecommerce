import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { AdminService } from './admin.service';
import { ApproveSellerDto, RejectSellerDto, UpdateSettingDto } from './dto';
import type { SellerStatus } from '@onsective/shared-types';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { WebAuthnService } from '../webauthn/webauthn.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly twoFactor: TwoFactorService,
    private readonly webauthn: WebAuthnService,
  ) {}

  @Get('sellers')
  listSellers(@Query('status') status?: SellerStatus) {
    return this.admin.listSellers(status);
  }

  @Post('sellers/:id/approve')
  approve(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: ApproveSellerDto, @Req() req: Request) {
    return this.admin.approveSeller(id, dto.commissionBps, { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('sellers/:id/reject')
  reject(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: RejectSellerDto, @Req() req: Request) {
    return this.admin.rejectSeller(id, dto.reason, { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Get('orders')
  listOrders() {
    return this.admin.listOrders();
  }

  @Get('settings')
  listSettings() {
    return this.admin.listSettings();
  }

  @Patch('settings')
  upsertSetting(@CurrentUser() u: RequestUser, @Body() dto: UpdateSettingDto, @Req() req: Request) {
    return this.admin.upsertSetting(dto.key, dto.value, dto.description, { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Get('audit-log')
  auditLog(
    @Query('actorUserId') actorUserId?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.admin.listAuditLog({ actorUserId, entityType, entityId });
  }

  @Get('revenue')
  revenue(@Query('rangeDays') rangeDays?: string) {
    return this.admin.revenueSnapshot(rangeDays ? Number(rangeDays) : 30);
  }

  /**
   * Phase 31: admin reset of a user's 2FA — for lock-out recovery when the
   * user has lost both their authenticator app and all recovery codes.
   * Idempotent; audits the actor.
   */
  @Post('users/:id/2fa/reset')
  resetUserTwoFactor(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.twoFactor.adminReset(id, {
      actorUserId: u.userId,
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  /** Phase 33: admin nukes all of a user's passkeys (lost-device recovery). */
  @Post('users/:id/webauthn/reset')
  resetUserWebauthn(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.webauthn.adminReset(id, {
      actorUserId: u.userId,
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }
}
