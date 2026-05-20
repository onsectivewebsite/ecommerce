import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsEmail, IsOptional, IsString, Length } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto';
import { JwtAuthGuard } from './jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { SecurityService } from '../security/security.service';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { ConsentService } from '../privacy/consent.service';
import { WebAuthnService } from '../webauthn/webauthn.service';

const ANON_CONSENT_COOKIE = 'ons_anon_consent';

const REFRESH_COOKIE = 'ons_refresh';

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/auth',
    expires: expiresAt,
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
}

/**
 * Mobile / non-browser clients can't use HttpOnly cookies, so we let them
 * opt in to receiving the refresh token in the response body by setting
 * either `X-Client: mobile` or `X-Refresh-In-Body: 1`. Browsers continue
 * to use the cookie path and never see the token.
 */
function wantsTokenInBody(req: Request): boolean {
  const client = String(req.headers['x-client'] ?? '').toLowerCase();
  const explicit = String(req.headers['x-refresh-in-body'] ?? '');
  return client === 'mobile' || explicit === '1';
}

function actorMeta(req: Request, userId?: string) {
  return {
    actorUserId: userId ?? null,
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  };
}

class TwoFactorVerifyDto {
  @IsString() @Length(8, 128) challenge!: string;
  @IsString() @Length(4, 32) code!: string;
}

class TwoFactorCodeOnlyDto {
  @IsString() @Length(4, 32) code!: string;
}

class WebAuthnRegisterStartDto {
  @IsString() @Length(1, 64) label!: string;
}

class WebAuthnRegisterVerifyDto {
  @IsString() @Length(8, 128) challenge!: string;
  @IsString() @Length(1, 1024) credentialId!: string;
  @IsString() @Length(1, 65536) clientDataJSON!: string;
  @IsString() @Length(1, 65536) attestationObject!: string;
  @IsOptional() @IsArray() transports?: string[];
  @IsString() @Length(1, 64) label!: string;
}

class WebAuthnLoginStartDto {
  @IsOptional() @IsEmail() email?: string;
}

class WebAuthnLoginVerifyDto {
  @IsString() @Length(8, 128) challenge!: string;
  @IsString() @Length(1, 1024) credentialId!: string;
  @IsString() @Length(1, 65536) clientDataJSON!: string;
  @IsString() @Length(1, 65536) authenticatorData!: string;
  @IsString() @Length(1, 65536) signature!: string;
  @IsOptional() @IsString() userHandle?: string;
}

class WebAuthnVerifyChallengeDto {
  /** Login-flow opaque challenge from /auth/login mfaRequired response. */
  @IsString() @Length(8, 128) loginChallenge!: string;
  /** Server-side WebAuthn challenge from /auth/webauthn/login/options. */
  @IsString() @Length(8, 128) challenge!: string;
  @IsString() @Length(1, 1024) credentialId!: string;
  @IsString() @Length(1, 65536) clientDataJSON!: string;
  @IsString() @Length(1, 65536) authenticatorData!: string;
  @IsString() @Length(1, 65536) signature!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly security: SecurityService,
    private readonly twoFactor: TwoFactorService,
    private readonly consent: ConsentService,
    private readonly webauthn: WebAuthnService,
  ) {}

  /**
   * Phase 32: fold any anonymous consent record into the user's identity at
   * login/register/2fa-verify time. Best-effort — never blocks the auth flow.
   */
  private async foldAnonConsent(userId: string, req: Request) {
    const anonId = req.cookies?.[ANON_CONSENT_COOKIE];
    if (typeof anonId !== 'string' || !anonId) return;
    await this.consent.resolveOnLogin(userId, anonId).catch(() => undefined);
  }

  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'auth.register', max: 5, windowSec: 3600, scope: 'ip' })
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.register(dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
    const issued = await this.auth.issueTokens(user.id, user.role as 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.foldAnonConsent(user.id, req).catch(() => undefined);
    setRefreshCookie(res, issued.refreshToken, issued.refreshExpiresAt);
    const me = await this.auth.getMeAuthUser(user.id);
    return {
      accessToken: issued.accessToken,
      expiresIn: issued.accessTtlSec,
      user: me,
      ...(wantsTokenInBody(req) ? { refreshToken: issued.refreshToken } : {}),
    };
  }

  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'auth.login', max: 10, windowSec: 60, scope: 'ip' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    let user;
    try {
      user = await this.auth.validate(dto);
    } catch (e) {
      this.recordFailedLogin(dto.email, req).catch(() => undefined);
      throw e;
    }
    // Phase 31: if 2FA is on, do NOT issue tokens. Hand back a short-lived
    // challenge that the client redeems via /auth/2fa/verify with the OTP.
    if (user.twoFactorEnabled) {
      const challenge = await this.twoFactor.createLoginChallenge(user.id);
      return { mfaRequired: true as const, challenge };
    }
    const issued = await this.auth.issueTokens(user.id, user.role as 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.security.recordLogin({
      userId: user.id,
      outcome: 'SUCCESS',
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      country: (req.headers['cf-ipcountry'] as string | undefined) ?? undefined,
    }).catch(() => undefined);
    this.foldAnonConsent(user.id, req).catch(() => undefined);
    setRefreshCookie(res, issued.refreshToken, issued.refreshExpiresAt);
    const me = await this.auth.getMeAuthUser(user.id);
    return {
      accessToken: issued.accessToken,
      expiresIn: issued.accessTtlSec,
      user: me,
      ...(wantsTokenInBody(req) ? { refreshToken: issued.refreshToken } : {}),
    };
  }

  @Post('2fa/verify')
  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'auth.2fa-verify', max: 10, windowSec: 60, scope: 'ip' })
  async twoFactorVerifyLogin(
    @Body() dto: TwoFactorVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.twoFactor.verifyChallenge(
      dto.challenge,
      dto.code,
      'LOGIN',
      actorMeta(req),
    );
    const user = await this.auth.getMeAuthUser(result.userId);
    const issued = await this.auth.issueTokens(
      result.userId,
      user.role as 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER',
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
    this.security
      .recordLogin({
        userId: result.userId,
        outcome: 'SUCCESS',
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
        country: (req.headers['cf-ipcountry'] as string | undefined) ?? undefined,
      })
      .catch(() => undefined);
    this.foldAnonConsent(result.userId, req).catch(() => undefined);
    setRefreshCookie(res, issued.refreshToken, issued.refreshExpiresAt);
    return {
      accessToken: issued.accessToken,
      expiresIn: issued.accessTtlSec,
      user,
      usedRecoveryCode: result.usedRecoveryCode,
      ...(wantsTokenInBody(req) ? { refreshToken: issued.refreshToken } : {}),
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('2fa/status')
  twoFactorStatus(@CurrentUser() u: RequestUser) {
    return this.twoFactor.status(u.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ rule: 'auth.2fa-enroll-start', max: 5, windowSec: 3600, scope: 'user' })
  @Post('2fa/enroll/start')
  twoFactorEnrollStart(@CurrentUser() u: RequestUser, @Req() req: Request) {
    return this.twoFactor.enrollStart(u.userId, actorMeta(req, u.userId));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('2fa/enroll/verify')
  twoFactorEnrollVerify(
    @CurrentUser() u: RequestUser,
    @Body() dto: TwoFactorCodeOnlyDto,
    @Req() req: Request,
  ) {
    return this.twoFactor.enrollVerify(u.userId, dto.code, actorMeta(req, u.userId));
  }

  /**
   * Disable flow: we treat the submitted code as a one-shot proof. Internally
   * we mint a DISABLE challenge and verify it in the same call to reuse the
   * same code-checking surface (TOTP + recovery code).
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ rule: 'auth.2fa-disable', max: 5, windowSec: 3600, scope: 'user' })
  @Post('2fa/disable')
  async twoFactorDisable(
    @CurrentUser() u: RequestUser,
    @Body() dto: TwoFactorCodeOnlyDto,
    @Req() req: Request,
  ) {
    const challenge = await this.twoFactor.createDisableChallenge(u.userId);
    await this.twoFactor.verifyChallenge(challenge, dto.code, 'DISABLE', actorMeta(req, u.userId));
    return this.twoFactor.disable(u.userId, actorMeta(req, u.userId));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ rule: 'auth.2fa-recovery-regen', max: 3, windowSec: 86400, scope: 'user' })
  @Post('2fa/recovery-codes/regenerate')
  async twoFactorRegenerateRecovery(
    @CurrentUser() u: RequestUser,
    @Body() dto: TwoFactorCodeOnlyDto,
    @Req() req: Request,
  ) {
    const challenge = await this.twoFactor.createDisableChallenge(u.userId);
    await this.twoFactor.verifyChallenge(challenge, dto.code, 'DISABLE', actorMeta(req, u.userId));
    return this.twoFactor.regenerateRecoveryCodes(u.userId, actorMeta(req, u.userId));
  }

  // ─────────────────────── WebAuthn / Passkeys (Phase 33) ───────────────────────

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ rule: 'auth.webauthn-register-options', max: 5, windowSec: 3600, scope: 'user' })
  @Post('webauthn/register/options')
  webauthnRegisterOptions(
    @CurrentUser() u: RequestUser,
    @Body() dto: WebAuthnRegisterStartDto,
  ) {
    return this.webauthn.registerOptions(u.userId, dto.label);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('webauthn/register/verify')
  webauthnRegisterVerify(
    @CurrentUser() u: RequestUser,
    @Body() dto: WebAuthnRegisterVerifyDto,
    @Req() req: Request,
  ) {
    return this.webauthn.registerVerify(u.userId, dto, actorMeta(req, u.userId));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('webauthn/credentials')
  webauthnList(@CurrentUser() u: RequestUser) {
    return this.webauthn.listCredentials(u.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('webauthn/credentials/:id/remove')
  webauthnRemove(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.webauthn.removeCredential(u.userId, id, actorMeta(req, u.userId));
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'auth.webauthn-login-options', max: 30, windowSec: 60, scope: 'ip' })
  @Post('webauthn/login/options')
  webauthnLoginOptions(@Body() dto: WebAuthnLoginStartDto) {
    return this.webauthn.loginOptions(dto.email ?? null);
  }

  /**
   * Passwordless sign-in. Verifies the WebAuthn assertion, then mints
   * tokens like /auth/login would. Bypasses the password step entirely;
   * the passkey is the sole proof of identity.
   */
  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'auth.webauthn-login-verify', max: 10, windowSec: 60, scope: 'ip' })
  @Post('webauthn/login/verify')
  async webauthnLoginVerify(
    @Body() dto: WebAuthnLoginVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.webauthn.loginVerify(dto, actorMeta(req));
    const user = await this.auth.getMeAuthUser(result.userId);
    const issued = await this.auth.issueTokens(
      result.userId,
      user.role as 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER',
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
    this.security
      .recordLogin({
        userId: result.userId,
        outcome: 'SUCCESS',
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
        country: (req.headers['cf-ipcountry'] as string | undefined) ?? undefined,
      })
      .catch(() => undefined);
    this.foldAnonConsent(result.userId, req).catch(() => undefined);
    setRefreshCookie(res, issued.refreshToken, issued.refreshExpiresAt);
    return {
      accessToken: issued.accessToken,
      expiresIn: issued.accessTtlSec,
      user,
      method: 'webauthn' as const,
      ...(wantsTokenInBody(req) ? { refreshToken: issued.refreshToken } : {}),
    };
  }

  /**
   * Phase 33: passkey as a second factor for password-first login. Frontend
   * received `mfaRequired: true, challenge: <loginChallenge>` from /auth/login,
   * then called /auth/webauthn/login/options to mint a webauthn challenge,
   * and now ships both back here with the assertion.
   */
  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'auth.2fa-verify', max: 10, windowSec: 60, scope: 'ip' })
  @Post('2fa/verify-passkey')
  async twoFactorVerifyPasskey(
    @Body() dto: WebAuthnVerifyChallengeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // 1) Verify the WebAuthn assertion (consumes the webauthn challenge).
    const passResult = await this.webauthn.loginVerify(
      {
        challenge: dto.challenge,
        credentialId: dto.credentialId,
        clientDataJSON: dto.clientDataJSON,
        authenticatorData: dto.authenticatorData,
        signature: dto.signature,
      },
      actorMeta(req),
    );
    // 2) Consume the original LOGIN-kind challenge, ensuring it belongs to
    //    the same user the assertion identified.
    await this.twoFactor.consumeLoginChallengeForUser(dto.loginChallenge, passResult.userId);
    // 3) Issue tokens.
    const user = await this.auth.getMeAuthUser(passResult.userId);
    const issued = await this.auth.issueTokens(
      passResult.userId,
      user.role as 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER',
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
    this.security
      .recordLogin({
        userId: passResult.userId,
        outcome: 'SUCCESS',
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
        country: (req.headers['cf-ipcountry'] as string | undefined) ?? undefined,
      })
      .catch(() => undefined);
    this.foldAnonConsent(passResult.userId, req).catch(() => undefined);
    setRefreshCookie(res, issued.refreshToken, issued.refreshExpiresAt);
    return {
      accessToken: issued.accessToken,
      expiresIn: issued.accessTtlSec,
      user,
      method: 'webauthn' as const,
      ...(wantsTokenInBody(req) ? { refreshToken: issued.refreshToken } : {}),
    };
  }

  private async recordFailedLogin(email: string, req: Request) {
    const user = await this.auth.findByEmail(email).catch(() => null);
    if (!user) return;
    await this.security.recordLogin({
      userId: user.id,
      outcome: 'FAILURE',
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      country: (req.headers['cf-ipcountry'] as string | undefined) ?? undefined,
    });
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const bodyToken = (req.body as { refreshToken?: string } | undefined)?.refreshToken ?? null;
    const cookieToken = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? null;
    const token = bodyToken ?? cookieToken;
    if (!token) throw new UnauthorizedException('Missing refresh token');
    const rotated = await this.auth.rotateRefresh(token, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setRefreshCookie(res, rotated.refreshToken, rotated.refreshExpiresAt);
    const me = await this.auth.getMeAuthUser(rotated.userId);
    return {
      accessToken: rotated.accessToken,
      expiresIn: rotated.accessTtlSec,
      user: me,
      ...(wantsTokenInBody(req) ? { refreshToken: rotated.refreshToken } : {}),
    };
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const bodyToken = (req.body as { refreshToken?: string } | undefined)?.refreshToken ?? null;
    const cookieToken = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? null;
    const token = bodyToken ?? cookieToken;
    if (token) await this.auth.revokeRefresh(token);
    clearRefreshCookie(res);
    return { ok: true };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.auth.getMeAuthUser(user.userId);
  }
}
