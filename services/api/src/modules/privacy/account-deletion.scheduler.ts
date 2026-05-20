import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountDeletionService } from './account-deletion.service';

const ONE_HOUR = 60 * 60 * 1000;

/**
 * Phase 26: walks REQUESTED users whose scheduledFor has passed and runs
 * the anonymize() transaction. Gated by
 * `PRIVACY_DELETION_SCHEDULER_ENABLED=1`.
 */
@Injectable()
export class AccountDeletionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountDeletionScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly svc: AccountDeletionService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('PRIVACY_DELETION_SCHEDULER_ENABLED') !== '1') return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.scan();
      } catch (e) {
        this.logger.warn(`deletion scan failed: ${(e as Error).message}`);
      } finally { this.running = false; }
    };
    tick();
    this.timer = setInterval(tick, ONE_HOUR);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Public so the admin controller can fire an on-demand scan in dev. */
  async scan(): Promise<{ scanned: number; anonymized: number; failed: number }> {
    const due = await this.svc.pendingDue();
    let ok = 0;
    let failed = 0;
    for (const u of due) {
      try {
        await this.svc.anonymize(u.id);
        ok++;
      } catch (e) {
        failed++;
        this.logger.warn(`anonymize ${u.id} failed: ${(e as Error).message}`);
      }
    }
    return { scanned: due.length, anonymized: ok, failed };
  }
}
