import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageFeesService } from './storage-fees.service';

const ONE_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class StorageFeesScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageFeesScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly fees: StorageFeesService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('STORAGE_FEES_ENABLED') !== '1') return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const r = await this.fees.accrueForYesterday();
        if (r.rows > 0) {
          this.logger.log(`storage accrued: rows=${r.rows} totalMinor=${r.totalFeeMinor}`);
        }
      } catch (e) {
        this.logger.warn(`storage accrual: ${(e as Error).message}`);
      } finally { this.running = false; }
    };
    tick();
    this.timer = setInterval(tick, ONE_DAY);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
