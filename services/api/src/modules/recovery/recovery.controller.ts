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
import { IsEmail, IsString, Length } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordResetService } from './password-reset.service';
import { AccountRecoveryService } from './account-recovery.service';
import { AccountRecoveryScheduler } from './account-recovery.scheduler';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';

class ForgotPasswordDto {
  @IsEmail() email!: string;
}
class ResetPasswordDto {
  @IsString() @Length(8, 256) token!: string;
  @IsString() @Length(8, 256) newPassword!: string;
}
class RecoveryStartDto {
  @IsEmail() email!: string;
}
class RecoveryTokenDto {
  @IsString() @Length(8, 256) token!: string;
}

function meta(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  };
}

@ApiTags('account-recovery')
@Controller('auth')
export class RecoveryController {
  constructor(
    private readonly passwordReset: PasswordResetService,
    private readonly recovery: AccountRecoveryService,
  ) {}

  // ───────────────────────── Password reset ─────────────────────────

  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'auth.password-forgot', max: 5, windowSec: 3600, scope: 'ip' })
  @Post('password/forgot')
  async forgot(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.passwordReset.forgot(dto.email, meta(req));
    // Always 200 — no account enumeration.
    return { ok: true as const };
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'auth.password-reset', max: 10, windowSec: 3600, scope: 'ip' })
  @Post('password/reset')
  reset(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.passwordReset.reset(dto.token, dto.newPassword, meta(req));
  }

  // ───────────────────────── 2FA lockout recovery ─────────────────────────

  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'auth.recovery-start', max: 3, windowSec: 86400, scope: 'ip' })
  @Post('recovery/start')
  async recoveryStart(@Body() dto: RecoveryStartDto, @Req() req: Request) {
    await this.recovery.start(dto.email, meta(req));
    return { ok: true as const };
  }

  @Post('recovery/confirm')
  recoveryConfirm(@Body() dto: RecoveryTokenDto) {
    return this.recovery.confirm(dto.token);
  }

  @Post('recovery/cancel')
  recoveryCancel(@Body() dto: RecoveryTokenDto) {
    return this.recovery.cancel(dto.token);
  }

  @Get('recovery/status')
  recoveryStatus(@Query('token') token: string) {
    return this.recovery.status(token);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'auth.recovery-complete', max: 5, windowSec: 3600, scope: 'ip' })
  @Post('recovery/complete')
  recoveryComplete(@Body() dto: RecoveryTokenDto, @Req() req: Request) {
    return this.recovery.complete(dto.token, meta(req));
  }
}

@ApiTags('admin-security')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/security')
export class AdminRecoveryController {
  constructor(
    private readonly recovery: AccountRecoveryService,
    private readonly scheduler: AccountRecoveryScheduler,
    private readonly prisma: PrismaService,
  ) {}

  @Get('recovery-requests')
  list() {
    return this.recovery.listActive();
  }

  @Post('recovery-requests/:id/cancel')
  async cancel(@Param('id') id: string) {
    const req = await this.prisma.accountRecoveryRequest.findUnique({ where: { id } });
    if (!req) return { ok: true as const };
    await this.recovery.cancelById(id, req.userId, true);
    return { ok: true as const };
  }

  @Post('recovery-requests/scan')
  scan() {
    return this.scheduler.scan();
  }
}
