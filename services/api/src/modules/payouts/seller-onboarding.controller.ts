import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { SellerOnboardingService } from './seller-onboarding.service';

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('seller-onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
@Controller('seller/onboarding/payouts')
export class SellerOnboardingController {
  constructor(private readonly svc: SellerOnboardingService) {}

  @Get('status')
  status(@CurrentUser() u: RequestUser) {
    return this.svc.statusForUser(u.userId);
  }

  @Post('start')
  start(@CurrentUser() u: RequestUser, @Req() req: Request) {
    return this.svc.startForUser(u.userId, actor(u, req));
  }

  @Post('login-link')
  loginLink(@CurrentUser() u: RequestUser) {
    return this.svc.loginLinkForUser(u.userId);
  }

  @Post('sync')
  async sync(@CurrentUser() u: RequestUser) {
    const status = await this.svc.statusForUser(u.userId);
    if (!status.sellerId) return status;
    await this.svc.sync(status.sellerId);
    return this.svc.statusForUser(u.userId);
  }
}

/**
 * Stripe-side return + refresh handlers. Stripe doesn't authenticate
 * these — it just bounces the seller's browser here after onboarding.
 * We re-sync from the canonical Stripe state by `sellerId` query param
 * and 302 the seller back to the seller-web onboarding page.
 */
@ApiTags('seller-onboarding-public')
@Controller('seller/onboarding/payouts')
export class SellerOnboardingReturnController {
  constructor(private readonly svc: SellerOnboardingService) {}

  @Get('return')
  async onReturn(@Query('sellerId') sellerId: string, @Res() res: Response) {
    if (sellerId) {
      try { await this.svc.sync(sellerId); } catch { /* sync errors should not block redirect */ }
    }
    res.redirect(HttpStatus.FOUND, this.svc.sellerWebReturnUrl(true));
  }

  @Get('refresh')
  async onRefresh(@Query('sellerId') _sellerId: string, @Res() res: Response) {
    // Refresh URL is hit when Stripe's onboarding link expires mid-flow.
    // We bounce back to the seller-web onboarding page where the user can
    // re-trigger `start` to get a fresh AccountLink.
    res.redirect(HttpStatus.FOUND, this.svc.sellerWebReturnUrl(false));
  }
}

@ApiTags('admin-seller-connect')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/sellers')
export class AdminSellerConnectController {
  constructor(private readonly svc: SellerOnboardingService) {}

  @Get(':id/connect')
  async details(@Param('id') id: string) {
    const synced = await this.svc.sync(id);
    if (!synced) return null;
    return this.svc.statusOf(synced);
  }

  @Post(':id/connect/sync')
  async forceSync(@Param('id') id: string) {
    const synced = await this.svc.adminForceSync(id);
    if (!synced) return null;
    return this.svc.statusOf(synced);
  }

  @Post(':id/connect/disable')
  disable(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.svc.adminDisable(id, actor(u, req));
  }
}
