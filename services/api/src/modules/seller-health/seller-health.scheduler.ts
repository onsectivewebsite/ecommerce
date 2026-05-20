import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SellerHealthService } from './seller-health.service';

const ONE_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class SellerHealthScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SellerHealthScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly health: SellerHealthService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('SELLER_HEALTH_ENABLED') !== '1') return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const r = await this.health.snapshotAllActive();
        this.logger.log(`seller-health: snapshots=${r.snapshots} paused=${r.paused}`);
      } catch (e) {
        this.logger.warn(`seller-health: ${(e as Error).message}`);
      } finally { this.running = false; }
    };
    tick();
    this.timer = setInterval(tick, ONE_DAY);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
