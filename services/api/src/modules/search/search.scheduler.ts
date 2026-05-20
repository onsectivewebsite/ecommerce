import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SearchIndexer } from './search.indexer';
import { EsClient } from './es-client';

const FIVE_MINUTES = 5 * 60 * 1000;

@Injectable()
export class SearchScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SearchScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly indexer: SearchIndexer,
    private readonly es: EsClient,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (!this.es.isReady()) return;
    if (this.cfg.get<string>('SEARCH_AUTO_SYNC') !== '1') return;
    this.indexer.incrementalSync().catch((e) => this.logger.warn(`initial sync: ${e.message}`));
    this.timer = setInterval(() => {
      this.indexer.incrementalSync().catch((e) => this.logger.warn(`scheduled sync: ${e.message}`));
    }, FIVE_MINUTES);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
