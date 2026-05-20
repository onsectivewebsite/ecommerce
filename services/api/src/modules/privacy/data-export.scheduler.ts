import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataExportService } from './data-export.service';

const ONE_MIN = 60 * 1000;

/**
 * Phase 26: drains PENDING DataExportRequest rows and sweeps expired
 * READY rows. Gated by `DATA_EXPORT_SCHEDULER_ENABLED=1` so dev/CI
 * doesn't accidentally process builder traffic.
 */
@Injectable()
export class DataExportScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataExportScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly svc: DataExportService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('DATA_EXPORT_SCHEDULER_ENABLED') !== '1') return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.svc.drainOnce();
      } catch (e) {
        this.logger.warn(`data export drain failed: ${(e as Error).message}`);
      } finally { this.running = false; }
    };
    tick();
    this.timer = setInterval(tick, ONE_MIN);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
