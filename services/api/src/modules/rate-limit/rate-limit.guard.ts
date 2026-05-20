import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  RATE_LIMIT_METADATA,
  type RateLimitOptions,
} from './rate-limit.decorator';
import { RateLimiterService, type RateLimitRule } from './rate-limiter.service';

interface MaybeRequestUser {
  userId?: string;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_METADATA,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!meta) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: MaybeRequestUser }>();
    const res = ctx.switchToHttp().getResponse<Response>();

    const scope = meta.scope ?? 'ip';
    const ip = (req.ip || (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || 'unknown').toString();
    const userId = req.user?.userId;
    const resolver = this.composeResolver(scope, ip, userId);
    if (!resolver) {
      // user-scope guard hit by an unauthenticated request — fall through.
      // The endpoint's own auth guard will reject it; rate-limit by IP
      // wouldn't help here.
      return true;
    }

    const key = `${meta.rule}:${scope}:${resolver}`;
    const rule: RateLimitRule = {
      rule: meta.rule,
      max: meta.max,
      windowSec: meta.windowSec,
      autoBlockSec: meta.autoBlockSec,
    };
    const check = await this.limiter.check(rule, {
      key,
      ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      userId,
      requestPath: req.path,
    });

    // Always set the rate-limit headers, including on allowed responses,
    // so clients can self-throttle.
    res.setHeader('X-RateLimit-Limit', String(meta.max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, meta.max - check.count)));
    res.setHeader('X-RateLimit-Reset', String(check.resetAt));

    if (!check.allowed) {
      if (check.retryAfterSec > 0) {
        res.setHeader('Retry-After', String(check.retryAfterSec));
      }
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: check.blockedUntil
            ? `Blocked until ${check.blockedUntil.toISOString()}`
            : 'Rate limit exceeded',
          retryAfterSec: check.retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private composeResolver(
    scope: RateLimitOptions['scope'],
    ip: string,
    userId?: string,
  ): string | null {
    switch (scope) {
      case 'user':
        return userId ?? null;
      case 'ip+user':
        return userId ? `${ip}|${userId}` : ip;
      case 'ip':
      default:
        return ip;
    }
  }
}
