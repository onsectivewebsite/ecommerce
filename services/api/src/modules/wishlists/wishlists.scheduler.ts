import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WishlistsService } from './wishlists.service';

const SIX_HOURS = 6 * 60 * 60 * 1000;

@Injectable()
export class WishlistsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WishlistsScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly wishlists: WishlistsService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('WISHLIST_WATCHER') !== '1') return;
    const tick = () => {
      this.wishlists.runWatcher()
        .then((r) => this.logger.log(`wishlist watcher: scanned=${r.scanned} notified=${r.notified}`))
        .catch((e) => this.logger.warn(`wishlist watcher: ${(e as Error).message}`));
    };
    tick();
    this.timer = setInterval(tick, SIX_HOURS);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
