import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SellerWebhooksService } from './seller-webhooks.service';

const ONE_MINUTE = 60_000;

@Injectable()
export class SellerWebhooksScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SellerWebhooksScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly hooks: SellerWebhooksService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('SELLER_WEBHOOKS_ENABLED') !== '1') return;
    const tick = async () => {
      if (this.running) return; // skip overlap
      this.running = true;
      try {
        const r = await this.hooks.dispatchDue(200);
        if (r.attempted > 0) {
          this.logger.log(`webhooks dispatched=${r.delivered}/${r.attempted} dead=${r.dead}`);
        }
      } catch (e) {
        this.logger.warn(`webhooks dispatch: ${(e as Error).message}`);
      } finally {
        this.running = false;
      }
    };
    tick();
    this.timer = setInterval(tick, ONE_MINUTE);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
