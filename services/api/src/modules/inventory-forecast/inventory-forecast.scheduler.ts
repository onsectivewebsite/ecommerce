import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InventoryForecastService } from './inventory-forecast.service';

const ONE_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class InventoryForecastScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InventoryForecastScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly forecast: InventoryForecastService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('INVENTORY_FORECAST_ENABLED') !== '1') return;
    const tick = () => {
      this.forecast.runOnce()
        .then((r) => this.logger.log(`forecast: scanned=${r.scanned} alerts=${r.alerts}`))
        .catch((e) => this.logger.warn(`forecast: ${(e as Error).message}`));
    };
    tick();
    this.timer = setInterval(tick, ONE_DAY);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
