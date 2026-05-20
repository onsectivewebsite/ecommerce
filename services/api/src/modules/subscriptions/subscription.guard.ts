import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TierFeature } from './tiers';
import { SubscriptionsService } from './subscriptions.service';

export const REQUIRE_TIER_FEATURE = 'require_tier_feature';
export const RequireTierFeature = (feature: Exclude<TierFeature, 'maxActiveProducts'>) =>
  SetMetadata(REQUIRE_TIER_FEATURE, feature);

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subs: SubscriptionsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<Exclude<TierFeature, 'maxActiveProducts'> | undefined>(
      REQUIRE_TIER_FEATURE,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!feature) return true;
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId as string | undefined;
    if (!userId) return false;
    await this.subs.requireFeature(userId, feature);
    return true;
  }
}
