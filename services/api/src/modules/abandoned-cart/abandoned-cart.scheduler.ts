import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AbandonedCartService } from './abandoned-cart.service';

const ONE_HOUR = 60 * 60 * 1000;

@Injectable()
export class AbandonedCartScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AbandonedCartScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly recovery: AbandonedCartService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('CART_RECOVERY_ENABLED') !== '1') return;
    const tick = () => {
      this.recovery.runOnce()
        .then((r) => this.logger.log(`cart-recovery: scanned=${r.scanned} s1=${r.stage1} s2=${r.stage2}`))
        .catch((e) => this.logger.warn(`cart-recovery: ${(e as Error).message}`));
    };
    tick();
    this.timer = setInterval(tick, ONE_HOUR);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
