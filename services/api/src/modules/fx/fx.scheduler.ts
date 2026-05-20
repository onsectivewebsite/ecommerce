import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FxService } from './fx.service';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Pulls fresh FX rates once per hour. Gated by FX_AUTO_REFRESH=1 so dev environments
 * without internet don't spam the logs. Replaced by a BullMQ cron in production
 * deployments (see infra/k8s/helm/onsective).
 */
@Injectable()
export class FxScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FxScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly fx: FxService,
    private readonly cfg: ConfigService,
  ) {}

  async onModuleInit() {
    if (this.cfg.get<string>('FX_AUTO_REFRESH') !== '1') return;
    // Best-effort initial refresh; ignore errors (offline dev).
    this.fx.refresh().catch((e) => this.logger.warn(`Initial FX refresh failed: ${e.message}`));
    this.timer = setInterval(() => {
      this.fx.refresh().catch((e) => this.logger.warn(`Scheduled FX refresh failed: ${e.message}`));
    }, ONE_HOUR_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
