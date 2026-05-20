import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GiftCardsService } from './gift-cards.service';

const ONE_HOUR = 60 * 60 * 1000;

/**
 * Phase 35: delivers scheduled gift cards whose `deliverAt` has arrived.
 * Gated by `GIFTCARD_SCHEDULER_ENABLED=1` so only one process in a cluster
 * runs it. Immediate (no `deliverAt`) cards are delivered inline by the
 * purchase listener and never touch this scheduler.
 */
@Injectable()
export class GiftCardsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GiftCardsScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly svc: GiftCardsService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('GIFTCARD_SCHEDULER_ENABLED') !== '1') return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const r = await this.svc.deliverDue();
        if (r.delivered) this.logger.log(`gift card scan: delivered ${r.delivered}`);
      } catch (e) {
        this.logger.warn(`gift card scan failed: ${(e as Error).message}`);
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
    return this.svc.deliverDue();
  }
}
