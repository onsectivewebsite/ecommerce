import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountRecoveryService } from './account-recovery.service';

const THIRTY_MIN = 30 * 60 * 1000;

/**
 * Phase 34: drives the 2FA-recovery waiting window — expires stale requests
 * and sends the 24h / 48h reminder and "ready" emails. Gated by
 * `RECOVERY_SCHEDULER_ENABLED=1` so it doesn't run in every dev process.
 */
@Injectable()
export class AccountRecoveryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountRecoveryScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly svc: AccountRecoveryService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('RECOVERY_SCHEDULER_ENABLED') !== '1') return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const r = await this.svc.scan();
        if (r.expired || r.reminded) {
          this.logger.log(`recovery scan: expired=${r.expired} reminded=${r.reminded}`);
        }
      } catch (e) {
        this.logger.warn(`recovery scan failed: ${(e as Error).message}`);
      } finally {
        this.running = false;
      }
    };
    tick();
    this.timer = setInterval(tick, THIRTY_MIN);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public so an admin endpoint can fire an on-demand scan in dev. */
  scan() {
    return this.svc.scan();
  }
}
