import { AuthGuard } from '@nestjs/passport';
import { ExecutionContext, Injectable } from '@nestjs/common';

/**
 * Like JwtAuthGuard but lets the request through with no user attached
 * when the Authorization header is missing or invalid. Useful for
 * endpoints that personalize behavior for signed-in users while still
 * serving anonymous traffic (e.g., outlet listings with Plus
 * early-access).
 */
@Injectable()
export class JwtOptionalAuthGuard extends AuthGuard('jwt') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRequest<TUser = any>(_err: any, user: any): TUser {
    return user ?? (null as unknown as TUser);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch {
      // Swallow auth errors — anonymous access is allowed.
    }
    return true;
  }
}
