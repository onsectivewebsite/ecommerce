import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AutoshipService } from './autoship.service';

const ONE_HOUR = 60 * 60 * 1000;

/**
 * Phase 37: places due Subscribe & Save orders. Gated by
 * `AUTOSHIP_SCHEDULER_ENABLED=1` so only one process in a cluster runs it.
 */
@Injectable()
export class AutoshipScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoshipScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly svc: AutoshipService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('AUTOSHIP_SCHEDULER_ENABLED') !== '1') {
      this.logger.log('Autoship scheduler idle (set AUTOSHIP_SCHEDULER_ENABLED=1 to enable)');
      return;
    }
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const r = await this.svc.processDue();
        if (r.processed > 0) {
          this.logger.log(
            `autoship scan: processed ${r.processed} (ok ${r.succeeded}, failed ${r.failed}, skipped ${r.skipped})`,
          );
        }
      } catch (e) {
        this.logger.warn(`autoship scan failed: ${(e as Error).message}`);
      } finally {
        this.running = false;
      }
    };
    tick();
    this.timer = setInterval(tick, ONE_HOUR);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public so an admin endpoint can fire an on-demand scan in dev. */
  scan() {
    return this.svc.processDue();
  }
}
