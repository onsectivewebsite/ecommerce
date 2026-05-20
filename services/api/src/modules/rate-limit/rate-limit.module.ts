import { Global, Module } from '@nestjs/common';
import { RateLimiterService } from './rate-limiter.service';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitAdminController } from './rate-limit-admin.controller';

@Global()
@Module({
  controllers: [RateLimitAdminController],
  providers: [RateLimiterService, RateLimitGuard],
  exports: [RateLimiterService, RateLimitGuard],
})
export class RateLimitModule {}
