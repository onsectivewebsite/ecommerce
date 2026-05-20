import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import type { Request, Response } from 'express';
import { DataExportStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { JwtOptionalAuthGuard } from '../auth/jwt-optional.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { DataExportService } from './data-export.service';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionScheduler } from './account-deletion.scheduler';
import { ConsentService } from './consent.service';
import { detectRegion } from './region';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';

const ANON_COOKIE = 'ons_anon_consent';

class RequestDeletionDto {
  @IsOptional() @IsString() @Length(1, 1000) reason?: string;
}

class ConsentCategoriesDto {
  @IsOptional() @IsBoolean() functional?: boolean;
  @IsOptional() @IsBoolean() analytics?: boolean;
  @IsOptional() @IsBoolean() marketing?: boolean;
  @IsOptional() @IsBoolean() marketingEmail?: boolean;
  @IsOptional() @IsBoolean() marketingSms?: boolean;
  @IsOptional() @IsBoolean() marketingPush?: boolean;
}

class CaptureConsentDto extends ConsentCategoriesDto {
  /** "accept-all" / "reject-all" / "custom" — recorded for analytics. Optional. */
  @IsOptional() @IsString() @Length(1, 32) preset?: string;
}

class UnsubscribeDto {
  @IsString() @Length(8, 256) token!: string;
}

function actor(u: RequestUser | null, req: Request) {
  return {
    userId: u?.userId ?? null,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

function readAnonCookie(req: Request): string | null {
  const c = req.cookies?.[ANON_COOKIE];
  return typeof c === 'string' && c.length > 0 ? c : null;
}

function setAnonCookie(res: Response, value: string) {
  res.cookie(ANON_COOKIE, value, {
    httpOnly: false, // banner JS reads it to suppress re-prompts
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ConsentService.ANON_COOKIE_TTL_DAYS * 86400 * 1000,
    path: '/',
  });
}

@ApiTags('privacy')
@Controller('privacy')
export class PrivacyController {
  constructor(
    private readonly exports: DataExportService,
    private readonly deletion: AccountDeletionService,
    private readonly consent: ConsentService,
  ) {}

  // ───────────────────────── Data export / deletion (JWT-gated) ─────────────────────────

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ rule: 'privacy.data-export', max: 3, windowSec: 86400, scope: 'user' })
  @Post('data-export')
  requestExport(@CurrentUser() u: RequestUser) {
    return this.exports.request(u.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('data-export')
  myExports(@CurrentUser() u: RequestUser) {
    return this.exports.listMine(u.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('data-export/:id/download')
  async download(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    const url = await this.exports.signedDownloadUrl(u.userId, id);
    return { url };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('delete')
  requestDeletion(
    @CurrentUser() u: RequestUser,
    @Body() dto: RequestDeletionDto,
    @Req() req: Request,
  ) {
    return this.deletion.request(u.userId, dto.reason, actor(u, req));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('delete/cancel')
  cancelDeletion(@CurrentUser() u: RequestUser, @Req() req: Request) {
    return this.deletion.cancel(u.userId, actor(u, req));
  }

  // ───────────────────────── Consent (auth optional) ─────────────────────────

  @UseGuards(JwtOptionalAuthGuard)
  @Get('consent')
  async getConsent(
    @CurrentUser() u: RequestUser | null,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    let anonId = readAnonCookie(req);
    // Mint an anonId on first read so subsequent POSTs from the banner can
    // upsert against a stable key.
    if (!u && !anonId) {
      anonId = ConsentService.generateAnonId();
      setAnonCookie(res, anonId);
    }
    const record = await this.consent.load({
      userId: u?.userId ?? null,
      anonId,
    });
    return {
      record,
      detectedRegion: detectRegion(req),
      policyVersion: this.consent.currentPolicyVersion,
      anonId: u ? null : anonId,
    };
  }

  @UseGuards(JwtOptionalAuthGuard)
  @Post('consent')
  async captureConsent(
    @CurrentUser() u: RequestUser | null,
    @Body() dto: CaptureConsentDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    let anonId = readAnonCookie(req);
    if (!u && !anonId) {
      anonId = ConsentService.generateAnonId();
      setAnonCookie(res, anonId);
    }
    const region = detectRegion(req);
    return this.consent.capture({
      userId: u?.userId ?? null,
      anonId: u ? null : anonId,
      region,
      source: 'BANNER',
      policyVersion: this.consent.currentPolicyVersion,
      categories: dto,
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('preferences')
  updatePreferences(
    @CurrentUser() u: RequestUser,
    @Body() dto: ConsentCategoriesDto,
    @Req() req: Request,
  ) {
    return this.consent.updatePreferences(u.userId, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  // ───────────────────────── Unsubscribe (public token) ─────────────────────────

  @Get('unsubscribe/lookup')
  lookupUnsubscribe(@Query('token') token: string) {
    if (!token) {
      return { ok: false as const, error: 'Missing token' };
    }
    return this.consent.lookupUnsubscribe(token);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'privacy.unsubscribe', max: 20, windowSec: 3600, scope: 'ip' })
  @Post('unsubscribe')
  consumeUnsubscribe(@Body() dto: UnsubscribeDto, @Req() req: Request) {
    return this.consent.consumeUnsubscribe(dto.token, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }
}

@ApiTags('admin-privacy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/privacy')
export class AdminPrivacyController {
  constructor(
    private readonly exports: DataExportService,
    private readonly deletion: AccountDeletionService,
    private readonly scheduler: AccountDeletionScheduler,
    private readonly consent: ConsentService,
  ) {}

  @Get('pending-deletions')
  pendingDeletions() {
    return this.deletion.pendingAll();
  }

  @Get('recent-exports')
  recentExports(@Query('limit') limit?: string, @Query('status') status?: DataExportStatus) {
    return this.exports.adminRecent({ limit: limit ? Number(limit) : 100, status });
  }

  @Post('scan-due')
  scanDue() {
    return this.scheduler.scan();
  }

  @Get('consent/metrics')
  consentMetrics() {
    return this.consent.metrics();
  }
}
