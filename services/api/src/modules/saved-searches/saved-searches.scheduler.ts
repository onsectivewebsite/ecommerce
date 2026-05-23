import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SavedSearchesService } from './saved-searches.service';

const ONE_HOUR = 60 * 60 * 1000;

/**
 * Phase 39: re-runs every saved search against the catalog and notifies
 * the owning buyer about new matches. Gated by
 * `SAVED_SEARCH_SCHEDULER_ENABLED=1` so only one process in a cluster
 * runs it.
 */
@Injectable()
export class SavedSearchesScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SavedSearchesScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly svc: SavedSearchesService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('SAVED_SEARCH_SCHEDULER_ENABLED') !== '1') {
      this.logger.log('Saved-search scheduler idle (set SAVED_SEARCH_SCHEDULER_ENABLED=1 to enable)');
      return;
    }
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const r = await this.svc.scan();
        if (r.totalNewMatches > 0) {
          this.logger.log(`saved-search scan: ${r.processed} searches, ${r.totalNewMatches} new matches`);
        }
      } catch (e) {
        this.logger.warn(`saved-search scan failed: ${(e as Error).message}`);
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

  /** Public so an admin endpoint can fire an on-demand scan. */
  scan() {
    return this.svc.scan();
  }
}
