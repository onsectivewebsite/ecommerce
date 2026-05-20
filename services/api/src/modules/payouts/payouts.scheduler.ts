import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PayoutsService } from './payouts.service';

/**
 * In-process daily payout sweep. Production deployments swap this for a BullMQ
 * cron in Phase 6; the same `PayoutsService.runForPeriod()` is called either way.
 *
 * Cadence: every 24h, at startup + every interval tick. Single-replica safe in
 * dev. The Payout (sellerId, periodEnd) unique index makes double-runs harmless.
 */
@Injectable()
export class PayoutsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutsScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly payouts: PayoutsService) {}

  onModuleInit() {
    const enabled = process.env.PAYOUTS_AUTO_RUN === '1';
    if (!enabled) {
      this.logger.log('Daily payouts scheduler idle (set PAYOUTS_AUTO_RUN=1 to enable)');
      return;
    }
    const interval = 24 * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      this.payouts.runForPeriod()
        .catch((e) => this.logger.warn(`Daily payout run failed: ${(e as Error).message}`));
    }, interval);
    this.timer.unref?.();
    this.logger.log('Daily payouts scheduler armed');
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
